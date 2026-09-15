"use server";

import { getEntries, type Entry } from "../../lib/conversations/service";
import { sendMessage, type SendResult } from "../../lib/chat/service";

// Sin login (principio 11): cualquiera puede llamarlas con un POST. Los servicios validan todo lo que llega.
export async function sendMessageAction(input: {
  conversationId?: unknown;
  clientMessageId?: unknown;
  message?: unknown;
}): Promise<SendResult> {
  try {
    return await sendMessage(input ?? {});
  } catch (e) {
    console.error("[chat] no se pudo responder:", e instanceof Error ? e.message : e);
    return { ok: false, error: "No pudimos responder. Intenta de nuevo." };
  }
}

// Mensajes nuevos del equipo, sin recargar (plan 004 §3). Devuelve null si la conversación ya no existe.
export async function newEntriesAction(conversationId: unknown, after: unknown): Promise<Entry[] | null> {
  const since = typeof after === "number" && Number.isFinite(after) ? after : 0;
  return getEntries(conversationId, { after: since, forClient: true });
}
