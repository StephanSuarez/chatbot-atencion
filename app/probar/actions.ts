"use server";

import { validateAttachment } from "../../lib/attachments/validate";
import { sendMessage, type SendResult } from "../../lib/chat/service";
import {
  getConversation,
  getEntries,
  type Entry,
  type Mode,
  type NewAttachment,
} from "../../lib/conversations/service";

// Sin login (principio 11): cualquiera puede llamarlas con un POST. Los servicios validan todo lo que llega.

// Un nombre absurdamente largo no se guarda entero; se valida ya recortado, así que si el recorte se lleva
// la extensión el archivo se rechaza, que es el lado seguro.
const MAX_NAME = 200;

/**
 * El mensaje viaja como `FormData` porque puede traer un archivo, igual que la subida de documentos (002).
 * Aquí es donde se valida el archivo: es el límite por el que entra algo de fuera (principio 3).
 */
export async function sendMessageAction(form: FormData): Promise<SendResult> {
  try {
    const file = form.get("file");
    let attachment: NewAttachment | undefined;

    if (file instanceof File) {
      const name = file.name.slice(0, MAX_NAME);
      const data = new Uint8Array(await file.arrayBuffer());
      const checked = validateAttachment(name, data);
      if (!checked.ok) return { ok: false, error: checked.error };
      attachment = { name, category: checked.category, contentType: checked.contentType, data };
    }

    return await sendMessage({
      conversationId: form.get("conversationId") ?? undefined,
      clientMessageId: form.get("clientMessageId") ?? undefined,
      message: form.get("message") ?? "",
      attachment,
    });
  } catch (e) {
    console.error("[chat] no se pudo responder:", e instanceof Error ? e.message : e);
    return { ok: false, error: "No pudimos responder. Intenta de nuevo." };
  }
}

// Mensajes nuevos del equipo, sin recargar (plan 004 §3). El modo viene también, para saber si se espera a
// una persona al recuperar la conversación. Devuelve null si la conversación ya no existe.
export async function newEntriesAction(
  conversationId: unknown,
  after: unknown,
): Promise<{ entries: Entry[]; mode: Mode } | null> {
  const since = typeof after === "number" && Number.isFinite(after) ? after : 0;
  const [entries, conversation] = await Promise.all([
    getEntries(conversationId, { after: since, forClient: true }),
    getConversation(conversationId),
  ]);
  if (!entries || !conversation) return null;
  return { entries, mode: conversation.mode };
}
