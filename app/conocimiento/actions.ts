"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { indexPending } from "../../lib/kb/indexer";
import { approveProposal, discardProposal } from "../../lib/learning/service";
import { proposeFromConversation } from "../../lib/learning/propose";
import {
  deleteDocument,
  deleteEntry,
  getDocumentText,
  MAX_FILE_BYTES,
  saveEntry,
  uploadDocument,
  type EntryResult,
  type UploadResult,
} from "../../lib/kb/service";

// Sin login (principio 11): cualquiera puede llamarlas con un POST. Lo que llega no es confiable.
const PATH = "/conocimiento";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (value: unknown) => (typeof value === "string" ? value : "");

const logError = (what: string, e: unknown) => console.error(`[kb] ${what}:`, e instanceof Error ? e.message : e);

// Los pedazos nuevos quedan pendientes: se les calcula el vector después de responder.
const index = () => after(() => indexPending().catch((e) => logError("no se pudo indexar", e)));

export async function saveEntryAction(input: { id?: string; title: string; content: string }): Promise<EntryResult> {
  const id = str(input?.id);
  if (id && !UUID.test(id)) return { ok: false, errors: { form: "Esa entrada ya no existe." } };
  try {
    const result = await saveEntry({ id: id || undefined, title: str(input?.title), content: str(input?.content) });
    if (result.ok) {
      revalidatePath(PATH);
      index();
    }
    return result;
  } catch (e) {
    logError("no se pudo guardar la entrada", e);
    return { ok: false, errors: { form: "No pudimos guardar. Tu texto sigue aquí; intenta de nuevo." } };
  }
}

export async function uploadDocumentAction(form: FormData): Promise<UploadResult> {
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Elige un documento para subir." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "El documento pesa más de 4 MB." };
  try {
    const result = await uploadDocument(file.name, new Uint8Array(await file.arrayBuffer()));
    if (result.ok) {
      revalidatePath(PATH);
      index();
    }
    return result;
  } catch (e) {
    logError("no se pudo subir el documento", e);
    return { ok: false, error: "No pudimos subir el documento. Intenta de nuevo." };
  }
}

export async function deleteItemAction(kind: "entry" | "document", id: string): Promise<{ ok: boolean; error?: string }> {
  if (!UUID.test(str(id))) return { ok: false, error: "Eso ya no existe." };
  try {
    await (kind === "entry" ? deleteEntry(id) : deleteDocument(id));
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    logError("no se pudo eliminar", e);
    return { ok: false, error: "No pudimos eliminarlo. Intenta de nuevo." };
  }
}

export async function documentTextAction(id: string): Promise<{ ok: true; text: string | null } | { ok: false; error: string }> {
  if (!UUID.test(str(id))) return { ok: false, error: "Ese documento ya no existe." };
  try {
    return { ok: true, text: await getDocumentText(id) };
  } catch (e) {
    logError("no se pudo leer el texto del documento", e);
    return { ok: false, error: "No pudimos mostrar el texto. Intenta de nuevo." };
  }
}

// ---------- Propuestas de conocimiento (005) ----------

export async function approveProposalAction(input: { id: string; title: string; content: string }): Promise<EntryResult> {
  const id = str(input?.id);
  if (!UUID.test(id)) return { ok: false, errors: { form: "Esa propuesta ya no existe." } };
  try {
    const result = await approveProposal(id, { title: str(input?.title), content: str(input?.content) });
    if (!result.ok) return { ok: false, errors: { form: result.error } };
    revalidatePath(PATH);
    // Los pedazos de la entrada nueva quedan pendientes: se indexan después de responder.
    index();
    return { ok: true, id: result.entryId };
  } catch (e) {
    logError("no se pudo aprobar la propuesta", e);
    return { ok: false, errors: { form: "No pudimos aprobarla. Intenta de nuevo." } };
  }
}

export async function discardProposalAction(id: unknown): Promise<{ ok: boolean }> {
  const proposalId = str(id);
  if (!UUID.test(proposalId)) return { ok: false };
  try {
    const discarded = await discardProposal(proposalId);
    if (discarded) revalidatePath(PATH);
    return { ok: discarded };
  } catch (e) {
    logError("no se pudo descartar la propuesta", e);
    return { ok: false };
  }
}

/** Reintenta redactar una propuesta que falló: se borra la fallida y se vuelve a pedir (FR-009). */
export async function retryProposalAction(input: { id: string; conversationId: string }): Promise<{ ok: boolean }> {
  const id = str(input?.id);
  const conversationId = str(input?.conversationId);
  if (!UUID.test(id) || !UUID.test(conversationId)) return { ok: false };
  try {
    await discardProposal(id);
    await proposeFromConversation(conversationId);
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    logError("no se pudo reintentar la propuesta", e);
    return { ok: false };
  }
}
