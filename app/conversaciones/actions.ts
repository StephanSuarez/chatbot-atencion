"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { proposeFromConversation } from "../../lib/learning/propose";
import { MAX_REPLY } from "./limits";
import {
  deleteConversation,
  getConversation,
  getEntries,
  saveTeamReply,
  setMode,
  type Entry,
  type Mode,
} from "../../lib/conversations/service";

// Sin login (principio 11): cualquiera puede llamarlas con un POST. El servicio valida lo que llega.
const PATH = "/conversaciones";
// La hora se formatea en el servidor: en el navegador la zona horaria puede ser otra y rompe la hidratación.
const hora = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" });

export type Result = { ok: boolean; error?: string };

const logError = (what: string, e: unknown) => console.error(`[conversaciones] ${what}:`, e instanceof Error ? e.message : e);

export async function deleteConversationAction(id: unknown): Promise<Result> {
  try {
    const deleted = await deleteConversation(id);
    if (!deleted) return { ok: false, error: "No se pudo borrar: la conversación espera respuesta o ya no existe." };
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    logError("no se pudo borrar", e);
    return { ok: false, error: "No se pudo borrar. Intenta de nuevo." };
  }
}

/** Todo lo que ve el equipo: mensajes, notas del bot y cambios de modo. `after` trae solo lo nuevo. */
export async function conversationAction(
  id: unknown,
  after: unknown,
): Promise<{ entries: (Entry & { when: string })[]; mode: Mode; derived: boolean; pending: boolean } | null> {
  const since = typeof after === "number" && Number.isFinite(after) ? after : 0;
  const [entries, conversation] = await Promise.all([
    getEntries(id, { after: since, forClient: false }),
    getConversation(id),
  ]);
  if (!entries || !conversation) return null;
  return {
    entries: entries.map((entry) => ({ ...entry, when: hora.format(entry.createdAt) })),
    mode: conversation.mode,
    derived: conversation.derived,
    pending: conversation.pending,
  };
}

export async function setModeAction(id: unknown, mode: unknown): Promise<Result> {
  if (mode !== "ia" && mode !== "humano") return { ok: false, error: "Modo desconocido." };
  try {
    const changed = await setMode(id, mode);
    if (!changed) return { ok: false, error: "Esa conversación ya no existe." };
    // Devolver la conversación al bot es la señal de «ya resolví»: se prepara lo que podría aprender (005).
    if (mode === "ia" && typeof id === "string") {
      after(() => proposeFromConversation(id).catch((e) => logError("no se pudo proponer conocimiento", e)));
    }
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    logError("no se pudo cambiar el modo", e);
    return { ok: false, error: "No se pudo cambiar el modo. Intenta de nuevo." };
  }
}

export async function replyAction(id: unknown, text: unknown): Promise<Result> {
  const message = typeof text === "string" ? text.trim() : "";
  if (!message) return { ok: false, error: "Escribe una respuesta." };
  if (message.length > MAX_REPLY) return { ok: false, error: `La respuesta supera los ${MAX_REPLY} caracteres.` };
  try {
    const saved = await saveTeamReply(id, message);
    if (!saved) return { ok: false, error: "Para responder, primero pasa la conversación a «Respondes tú»." };
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    logError("no se pudo responder", e);
    return { ok: false, error: "No se pudo enviar la respuesta. Intenta de nuevo." };
  }
}
