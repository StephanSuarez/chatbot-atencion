import { and, asc, desc, eq, gt, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { conversationEntries, conversations } from "../schema";

// Reglas de guardado de la spec 004 (plan §5, §6). No llama al modelo: eso lo hace el servicio de chat.

export type Mode = "ia" | "humano";
export type Author = "cliente" | "bot" | "equipo" | "nota" | "evento";
export type TypeFilter = "todas" | "derivadas" | "sin_derivar";

// Lo que ve el cliente. Notas y eventos son solo para el equipo (FR-012, FR-016).
export const CLIENT_AUTHORS: Author[] = ["cliente", "bot", "equipo"];

export interface Entry {
  seq: number;
  author: Author;
  text: string;
  createdAt: Date;
}

export interface ConversationSummary {
  id: string;
  origin: "chat_de_prueba";
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
const pending = sql<boolean>`(${conversations.mode} = 'humano' and ${lastClientAuthor} = 'cliente')`;

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

/**
 * Guarda un mensaje del cliente. Si la conversación no existe (primera vez o fue borrada) crea una nueva.
 * El id del mensaje lo genera el navegador: reintentar el mismo mensaje no lo duplica.
 */
export async function saveClientMessage(input: { conversationId?: unknown; clientMessageId: string; text: string }) {
  return db.transaction(async (tx) => {
    const existing = isUuid(input.conversationId)
      ? (await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, input.conversationId)))[0]
      : undefined;
    const conversationId =
      existing?.id ?? (await tx.insert(conversations).values({ origin: "chat_de_prueba" }).returning({ id: conversations.id }))[0].id;

    const [inserted] = await tx
      .insert(conversationEntries)
      .values({ conversationId, author: "cliente", text: input.text, clientMessageId: input.clientMessageId })
      .onConflictDoNothing({ target: conversationEntries.clientMessageId })
      .returning({ seq: conversationEntries.seq });
    if (inserted) {
      await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
      return { conversationId, seq: inserted.seq, duplicate: false };
    }
    // Reintento: el mensaje ya estaba guardado, quizás en la conversación con la que se envió la primera vez.
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
  turn: { entries: { author: "bot" | "nota" | "evento"; text: string }[]; toHuman?: boolean; personRequests?: number },
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
        ...(turn.toHuman && { mode: "humano" as const, derived: true }),
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

/** Respuesta del equipo: solo en modo humano (FR-017). */
export async function saveTeamReply(conversationId: unknown, text: string): Promise<boolean> {
  if (!isUuid(conversationId)) return false;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ mode: conversations.mode })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for("update");
    if (row?.mode !== "humano") return false;
    await tx.insert(conversationEntries).values({ conversationId, author: "equipo", text });
    await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
    return true;
  });
}

/** Entradas en orden. `after` trae solo las nuevas (consulta cada 3 s). `forClient` deja fuera notas y eventos. */
export async function getEntries(conversationId: unknown, opts: { after?: number; forClient: boolean }): Promise<Entry[] | null> {
  if (!isUuid(conversationId)) return null;
  const [exists] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId));
  if (!exists) return null;
  const conditions: SQL[] = [eq(conversationEntries.conversationId, conversationId)];
  if (opts.after !== undefined) conditions.push(gt(conversationEntries.seq, opts.after));
  if (opts.forClient) conditions.push(inArray(conversationEntries.author, CLIENT_AUTHORS));
  return db
    .select({
      seq: conversationEntries.seq,
      author: conversationEntries.author,
      text: conversationEntries.text,
      createdAt: conversationEntries.createdAt,
    })
    .from(conversationEntries)
    .where(and(...conditions))
    .orderBy(asc(conversationEntries.seq));
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

/** Borra una conversación y sus entradas (FR-006). Una pendiente no se puede borrar. */
export async function deleteConversation(id: unknown): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), sql`not ${pending}`))
    .returning({ id: conversations.id });
  return deleted.length > 0;
}
