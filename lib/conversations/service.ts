import { and, asc, desc, eq, gt, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import type { Category } from "../attachments/validate";
import { conversationAttachments, conversationEntries, conversations } from "../schema";

// Reglas de guardado de la spec 004 (plan §5, §6). No llama al modelo: eso lo hace el servicio de chat.

export type Mode = "ia" | "humano";
export type Author = "cliente" | "bot" | "equipo" | "nota" | "evento";
export type TypeFilter = "todas" | "derivadas" | "sin_derivar";

// Lo que ve el cliente. Notas y eventos son solo para el equipo (FR-012, FR-016).
export const CLIENT_AUTHORS: Author[] = ["cliente", "bot", "equipo"];

// La categoría la decide el validador (`lib/attachments`): se reexporta para no tener dos uniones que
// puedan divergir en silencio.
export type { Category };

/** La ficha del adjunto: lo que viaja con los mensajes. Los bytes se piden aparte, por su id. */
export interface Attachment {
  id: string;
  name: string;
  category: Category;
  contentType: string;
  sizeBytes: number;
}

/** Un adjunto ya validado (`lib/attachments`), listo para guardarse. */
export interface NewAttachment {
  name: string;
  category: Category;
  contentType: string;
  data: Uint8Array<ArrayBuffer>;
}

export interface Entry {
  seq: number;
  author: Author;
  text: string;
  createdAt: Date;
  attachment?: Attachment;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Guarda el adjunto dentro de la transacción de su mensaje: si esto falla, el mensaje tampoco queda
 * (FR-014). Lo usan tanto el mensaje del cliente como la respuesta del equipo.
 */
function attach(tx: Tx, entrySeq: number, file: NewAttachment) {
  return tx.insert(conversationAttachments).values({
    entrySeq,
    name: file.name,
    category: file.category,
    contentType: file.contentType,
    sizeBytes: file.data.length,
    data: file.data,
  });
}

export type Origin = "chat_de_prueba" | "simulacion";

export interface ConversationSummary {
  id: string;
  origin: Origin;
  mode: Mode;
  derived: boolean;
  pending: boolean;
  lastMessageAt: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

// Pendiente (FR-018): modo humano y el último mensaje visible es del cliente. Se calcula, no se guarda.
const lastClientAuthor = sql<string | null>`(
  select ${conversationEntries.author} from ${conversationEntries}
  where ${conversationEntries.conversationId} = ${conversations.id}
    and ${conversationEntries.author} in ('cliente', 'bot', 'equipo')
  order by ${conversationEntries.seq} desc limit 1)`;
const pending = sql<boolean>`coalesce(
  ${conversations.origin} <> 'simulacion' and ${conversations.mode} = 'humano' and ${lastClientAuthor} = 'cliente', false)`;

const summary = {
  id: conversations.id,
  origin: conversations.origin,
  mode: conversations.mode,
  derived: conversations.derived,
  pending,
  lastMessageAt: conversations.lastMessageAt,
};

export async function getConversation(id: unknown) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({ ...summary, personRequests: conversations.personRequests })
    .from(conversations)
    .where(eq(conversations.id, id));
  return row ?? null;
}

// El id del mensaje lo genera el navegador: reintentar el mismo mensaje no lo duplica.
export async function saveClientMessage(input: {
  conversationId?: unknown;
  clientMessageId: string;
  text: string;
  origin?: Origin;
  attachment?: NewAttachment;
}) {
  return db.transaction(async (tx) => {
    const existing = isUuid(input.conversationId)
      ? (await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, input.conversationId)))[0]
      : undefined;
    const created = existing
      ? undefined
      : (await tx.insert(conversations).values({ origin: input.origin ?? "chat_de_prueba" }).returning())[0];
    const conversationId = existing?.id ?? created!.id;

    const [inserted] = await tx
      .insert(conversationEntries)
      .values({ conversationId, author: "cliente", text: input.text, clientMessageId: input.clientMessageId })
      .onConflictDoNothing({ target: conversationEntries.clientMessageId })
      .returning({ seq: conversationEntries.seq });
    if (inserted) {
      if (input.attachment) await attach(tx, inserted.seq, input.attachment);
      await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
      return { conversationId, seq: inserted.seq, duplicate: false };
    }
    // Reintento: el mensaje ya estaba guardado, quizás en otra conversación; la recién creada sobra.
    if (created) await tx.delete(conversations).where(eq(conversations.id, created.id));
    const [previous] = await tx
      .select({ conversationId: conversationEntries.conversationId, seq: conversationEntries.seq })
      .from(conversationEntries)
      .where(eq(conversationEntries.clientMessageId, input.clientMessageId));
    return { ...previous, duplicate: true };
  });
}

/**
 * Guarda el turno del bot solo si la conversación sigue en modo IA: si el equipo la tomó mientras el modelo
 * respondía, se descarta (plan §3, paso 5). Bloquea la fila para que el cambio de modo no se cruce.
 */
export async function saveBotTurn(
  conversationId: string,
  turn: {
    entries: { author: "bot" | "nota" | "evento"; text: string }[];
    toHuman?: boolean;
    personRequests?: number;
    handoffReason?: "no_sabe" | "enojo" | "pide_persona";
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ mode: conversations.mode })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");
    if (row?.mode !== "ia") return false;

    await tx.insert(conversationEntries).values(turn.entries.map((e) => ({ conversationId, ...e })));
    await tx
      .update(conversations)
      .set({
        ...(turn.entries.some((e) => e.author === "bot") && { lastMessageAt: new Date() }),
        ...(turn.toHuman && { mode: "humano" as const, derived: true, handoffReason: turn.handoffReason }),
        ...(turn.personRequests !== undefined && { personRequests: turn.personRequests }),
      })
      .where(eq(conversations.id, conversationId));
    return true;
  });
}

const MODE_EVENT: Record<Mode, string> = {
  humano: "El equipo pasó la conversación a modo humano.",
  ia: "El equipo activó la IA.",
};

/** Cambio de modo hecho por el equipo (FR-016). Activar la IA reinicia el conteo de pedidos de persona (FR-009). */
export async function setMode(conversationId: unknown, mode: Mode): Promise<boolean> {
  if (!isUuid(conversationId)) return false;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ mode: conversations.mode })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");
    if (!row) return false;
    if (row.mode === mode) return true;
    await tx
      .update(conversations)
      .set({ mode, ...(mode === "ia" && { personRequests: 0 }) })
      .where(eq(conversations.id, conversationId));
    await tx.insert(conversationEntries).values({ conversationId, author: "evento", text: MODE_EVENT[mode] });
    return true;
  });
}

export async function saveTeamReply(
  conversationId: unknown,
  text: string,
  attachment?: NewAttachment,
): Promise<boolean> {
  if (!isUuid(conversationId)) return false;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ mode: conversations.mode })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");
    if (row?.mode !== "humano") return false;
    const [inserted] = await tx
      .insert(conversationEntries)
      .values({ conversationId, author: "equipo", text })
      .returning({ seq: conversationEntries.seq });
    if (attachment) await attach(tx, inserted.seq, attachment);
    await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
    return true;
  });
}

export async function getEntries(conversationId: unknown, opts: { after?: number; forClient: boolean }): Promise<Entry[] | null> {
  if (!isUuid(conversationId)) return null;
  const [exists] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId));
  if (!exists) return null;
  const conditions: SQL[] = [eq(conversationEntries.conversationId, conversationId)];
  if (opts.after !== undefined) conditions.push(gt(conversationEntries.seq, opts.after));
  if (opts.forClient) conditions.push(inArray(conversationEntries.author, CLIENT_AUTHORS));
  const rows = await db
    .select({
      seq: conversationEntries.seq,
      author: conversationEntries.author,
      text: conversationEntries.text,
      createdAt: conversationEntries.createdAt,
      attachmentId: conversationAttachments.id,
      name: conversationAttachments.name,
      category: conversationAttachments.category,
      contentType: conversationAttachments.contentType,
      sizeBytes: conversationAttachments.sizeBytes,
    })
    .from(conversationEntries)
    // Solo la ficha del adjunto: los bytes se piden por su propia URL, así que el sondeo no los arrastra.
    .leftJoin(conversationAttachments, eq(conversationAttachments.entrySeq, conversationEntries.seq))
    .where(and(...conditions))
    .orderBy(asc(conversationEntries.seq));

  return rows.map(({ attachmentId, name, category, contentType, sizeBytes, ...entry }) =>
    attachmentId
      ? { ...entry, attachment: { id: attachmentId, name: name!, category: category!, contentType: contentType!, sizeBytes: sizeBytes! } }
      : entry,
  );
}

/** Los bytes de un adjunto, para servirlo. Es el único sitio que los lee. */
export async function getAttachment(id: unknown) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({
      name: conversationAttachments.name,
      category: conversationAttachments.category,
      contentType: conversationAttachments.contentType,
      data: conversationAttachments.data,
    })
    .from(conversationAttachments)
    .where(eq(conversationAttachments.id, id));
  return row ?? null;
}

/** Pendientes primero; el resto de la más reciente a la más antigua (FR-019). `to` es exclusivo. */
export function listConversations(filters: { from?: Date; to?: Date; type?: TypeFilter } = {}): Promise<ConversationSummary[]> {
  const conditions: SQL[] = [];
  if (filters.from) conditions.push(gte(conversations.lastMessageAt, filters.from));
  if (filters.to) conditions.push(lt(conversations.lastMessageAt, filters.to));
  if (filters.type === "derivadas") conditions.push(eq(conversations.derived, true));
  if (filters.type === "sin_derivar") conditions.push(eq(conversations.derived, false));
  return db
    .select(summary)
    .from(conversations)
    .where(and(...conditions))
    .orderBy(desc(pending), desc(conversations.lastMessageAt));
}

export async function countPending(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(conversations).where(pending);
  return row.n;
}

export async function deleteConversation(id: unknown): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), sql`not ${pending}`))
    .returning({ id: conversations.id });
  return deleted.length > 0;
}
