"use server";

import { sendMessage, type SendResult } from "../../lib/chat/service";

// Sin login (principio 11): cualquiera puede llamarla con un POST. El servicio valida todo lo que llega.
export async function sendMessageAction(input: { history?: unknown; message?: unknown }): Promise<SendResult> {
  try {
    return await sendMessage({ history: input?.history, message: input?.message });
  } catch (e) {
    console.error("[chat] no se pudo responder:", e instanceof Error ? e.message : e);
    return { ok: false, error: "No pudimos responder. Intenta de nuevo." };
  }
}
