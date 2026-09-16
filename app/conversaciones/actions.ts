"use server";

import { revalidatePath } from "next/cache";
import { deleteConversation } from "../../lib/conversations/service";

// Sin login (principio 11): cualquiera puede llamarla con un POST. El servicio valida lo que llega.
export async function deleteConversationAction(id: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const deleted = await deleteConversation(id);
    if (!deleted) return { ok: false, error: "No se pudo borrar: la conversación espera respuesta o ya no existe." };
    revalidatePath("/conversaciones");
    return { ok: true };
  } catch (e) {
    console.error("[conversaciones] no se pudo borrar:", e instanceof Error ? e.message : e);
    return { ok: false, error: "No se pudo borrar. Intenta de nuevo." };
  }
}
