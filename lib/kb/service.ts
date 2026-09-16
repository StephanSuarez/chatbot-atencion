import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { EMBEDDING_MODEL } from "../providers";
import { kbChunks, kbDocuments, kbEntries } from "../schema";
import { chunkText } from "./chunk";
import { ExtractError, extractText, kindOf } from "./extract";

// Reglas de la spec 002 (plan §4). No lanza el indexador: lo hacen las server actions con after(),
// igual que al guardar la configuración, para que este módulo no dependa del ciclo de vida de Next.

export const MAX_DOCUMENTS = 20;
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
// Un "procesando" más viejo que esto quedó huérfano (el servidor se cayó a mitad, plan §8).
const STALE_PROCESSING_MS = 5 * 60 * 1000;
const STALE_REASON = "Se interrumpió el procesamiento. Vuelve a subir el documento.";

export type EntryErrors = Partial<Record<"title" | "content" | "form", string>>;
export type EntryResult = { ok: true; id: string } | { ok: false; errors: EntryErrors };
export type UploadResult = { ok: true; id: string } | { ok: false; error: string };

export interface DocumentSummary {
  id: string;
  name: string;
  status: "procesando" | "listo" | "no_se_pudo_leer";
  error: string | null;
  createdAt: Date;
}

// ---------- Entradas de texto ----------

export function listEntries() {
  return db.select().from(kbEntries).orderBy(asc(kbEntries.createdAt));
}

export async function saveEntry(input: {
  id?: string;
  title: string;
  content: string;
  learnedFromConversationId?: string;
}): Promise<EntryResult> {
  const title = input.title.trim();
  const content = input.content.trim();
  const errors: EntryErrors = {};
  if (!title) errors.title = "Escribe un título.";
  if (!content) errors.content = "Escribe el contenido.";
  if (Object.keys(errors).length) return { ok: false, errors };

  // Editar reemplaza los pedazos en la misma transacción: nunca queda la entrada con pedazos viejos.
  const id = await db.transaction(async (tx) => {
    const [entry] = input.id
      ? await tx.update(kbEntries).set({ title, content, updatedAt: new Date() }).where(eq(kbEntries.id, input.id)).returning()
      : await tx
          .insert(kbEntries)
          .values({ title, content, learnedFromConversationId: input.learnedFromConversationId })
          .returning();
    if (!entry) return null;
    await tx.delete(kbChunks).where(eq(kbChunks.entryId, entry.id));
    await tx.insert(kbChunks).values(chunkText(title, content).map((text, position) => ({ entryId: entry.id, position, text })));
    return entry.id;
  });
  return id ? { ok: true, id } : { ok: false, errors: { form: "Esa entrada ya no existe." } };
}

export async function deleteEntry(id: string): Promise<void> {
  await db.delete(kbEntries).where(eq(kbEntries.id, id));
}

// ---------- Documentos ----------

export async function listDocuments(now = new Date()): Promise<DocumentSummary[]> {
  const rows = await db
    .select({
      id: kbDocuments.id,
      name: kbDocuments.name,
      status: kbDocuments.status,
      error: kbDocuments.error,
      createdAt: kbDocuments.createdAt,
    })
    .from(kbDocuments)
    .orderBy(desc(kbDocuments.createdAt));
  return rows.map((doc) => (isStale(doc, now) ? { ...doc, status: "no_se_pudo_leer", error: STALE_REASON } : doc));
}

const isStale = (doc: { status: string; createdAt: Date }, now = new Date()) =>
  doc.status === "procesando" && now.getTime() - doc.createdAt.getTime() > STALE_PROCESSING_MS;

export async function getDocumentText(id: string): Promise<string | null> {
  const [doc] = await db
    .select({ text: kbDocuments.text })
    .from(kbDocuments)
    .where(and(eq(kbDocuments.id, id), eq(kbDocuments.status, "listo")));
  return doc?.text ?? null;
}

export async function uploadDocument(name: string, data: Uint8Array): Promise<UploadResult> {
  if (!kindOf(name)) return { ok: false, error: "Solo se aceptan documentos PDF, Word (.docx) y .txt." };
  if (data.length > MAX_FILE_BYTES) return { ok: false, error: "El documento pesa más de 4 MB." };

  const contentHash = createHash("sha256").update(data).digest("hex");
  const created = await registerDocument(name, contentHash);
  if (!created.ok) return created;

  await processDocument(created.id, name, data);
  return created;
}

export async function deleteDocument(id: string): Promise<void> {
  await db.delete(kbDocuments).where(eq(kbDocuments.id, id));
}

// Pedazos que el bot todavía no puede usar (aviso de indexación pendiente en la pantalla).
export async function countPendingChunks(): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(kbChunks)
    .where(or(isNull(kbChunks.embedding), ne(kbChunks.embeddingModel, EMBEDDING_MODEL)));
  return n;
}

// El límite de 20 y el duplicado se comprueban con un lock: dos subidas a la vez no pueden pasar ambas.
async function registerDocument(name: string, contentHash: string): Promise<UploadResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kb_documents'))`);

    const [duplicate] = await tx
      .select({ id: kbDocuments.id, name: kbDocuments.name, status: kbDocuments.status, createdAt: kbDocuments.createdAt })
      .from(kbDocuments)
      .where(eq(kbDocuments.contentHash, contentHash));
    // Volver a subir un documento fallido o interrumpido lo reemplaza: es lo que la pantalla le pide al usuario.
    if (duplicate?.status === "no_se_pudo_leer" || (duplicate && isStale(duplicate))) {
      await tx.delete(kbDocuments).where(eq(kbDocuments.id, duplicate.id));
    } else if (duplicate) {
      return { ok: false, error: `Este archivo ya está cargado como "${duplicate.name}".` } as const;
    }

    const [{ n }] = await tx.select({ n: count() }).from(kbDocuments);
    if (n >= MAX_DOCUMENTS) {
      return { ok: false, error: `Ya tienes ${MAX_DOCUMENTS} documentos. Elimina alguno para subir otro.` } as const;
    }

    const [doc] = await tx.insert(kbDocuments).values({ name, contentHash, status: "procesando" }).returning({ id: kbDocuments.id });
    return { ok: true, id: doc.id } as const;
  });
}

async function processDocument(id: string, name: string, data: Uint8Array): Promise<void> {
  let text: string;
  try {
    text = await extractText(name, data);
  } catch (e) {
    const reason = e instanceof ExtractError ? e.reason : "No se pudo procesar el documento. Vuelve a subirlo.";
    if (!(e instanceof ExtractError)) console.error(`[kb] documento ${id}: error al extraer`, (e as Error)?.message);
    await db.update(kbDocuments).set({ status: "no_se_pudo_leer", error: reason }).where(eq(kbDocuments.id, id));
    return;
  }

  // Si lo eliminaron mientras se procesaba, no queda nada: sin documento no se agregan pedazos.
  await db.transaction(async (tx) => {
    const [doc] = await tx.update(kbDocuments).set({ status: "listo", text }).where(eq(kbDocuments.id, id)).returning();
    if (!doc) return;
    await tx.insert(kbChunks).values(chunkText(name, text).map((chunk, position) => ({ documentId: id, position, text: chunk })));
  });
}
