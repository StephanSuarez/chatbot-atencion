"use server";

import { sendMessage, type SendResult } from "../../lib/chat/service";
import { getConversation, getEntries, type Entry, type Mode } from "../../lib/conversations/service";

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
