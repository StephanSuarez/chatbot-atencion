import { and, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { conversationEntries, conversations } from "../schema";

// Métricas de conversaciones (plan 008). Solo lee y agrega: no escribe nada y **no llama al
// proveedor de LLM** (FR-008), para que mirar los números nunca cueste dinero.

export interface Range {
  from?: Date;
  to?: Date;
}

export interface Summary {
  total: number;
  solvedByBot: number;
  derived: number;
  pending: number;
  resolutionRate: number;
}

export type HandoffReason = "no_sabe" | "enojo" | "pide_persona";
export type ReasonBreakdown = Record<HandoffReason | "sin_registrar", number>;

export interface Topic {
  title: string;
  count: number;
  derivedCount: number;
  examples: string[];
}

const inRange = (range: Range): SQL[] => {
  const conditions: SQL[] = [];
  if (range.from) conditions.push(gte(conversations.lastMessageAt, range.from));
  if (range.to) conditions.push(lt(conversations.lastMessageAt, range.to));
  return conditions;
};

// Pendiente: en modo humano y con el último mensaje visible del cliente (misma regla que la 004).
const pending = sql<boolean>`coalesce(${conversations.mode} = 'humano' and (
  select ${conversationEntries.author} from ${conversationEntries}
  where ${conversationEntries.conversationId} = ${conversations.id}
    and ${conversationEntries.author} in ('cliente', 'bot', 'equipo')
  order by ${conversationEntries.seq} desc limit 1) = 'cliente', false)`;

export async function summary(range: Range = {}): Promise<Summary> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      derived: sql<number>`count(*) filter (where ${conversations.derived})::int`,
      pending: sql<number>`count(*) filter (where ${pending})::int`,
    })
    .from(conversations)
    .where(and(...inRange(range)));

  const solvedByBot = row.total - row.derived;
  return {
    total: row.total,
    solvedByBot,
    derived: row.derived,
    pending: row.pending,
    resolutionRate: row.total ? Math.round((solvedByBot / row.total) * 100) : 0,
  };
}

export async function handoffReasons(range: Range = {}): Promise<ReasonBreakdown> {
  const rows = await db
    .select({ reason: conversations.handoffReason, n: sql<number>`count(*)::int` })
    .from(conversations)
    .where(and(eq(conversations.derived, true), ...inRange(range)))
    .groupBy(conversations.handoffReason);

  const breakdown: ReasonBreakdown = { no_sabe: 0, enojo: 0, pide_persona: 0, sin_registrar: 0 };
  for (const row of rows) breakdown[row.reason ?? "sin_registrar"] = row.n;
  return breakdown;
}

// ---------- Temas más preguntados ----------

// ponytail: agrupación por palabras, sin embeddings. Techo conocido: no une «¿tienen wifi?» con
// «¿hay internet?». Si se queda corta, el siguiente paso es reusar los embeddings de la 002.
const STOP_WORDS = new Set([
  "hola", "buenas", "buenos", "dias", "tardes", "noches", "gracias", "por", "favor", "que", "qué", "como", "cómo",
  "cual", "cuál", "cuanto", "cuánto", "cuando", "cuándo", "donde", "dónde", "para", "una", "uno", "los", "las", "del",
  "con", "sin", "esta", "este", "eso", "esa", "ustedes", "tienen", "tiene", "hay", "puedo", "puede", "quiero",
  "necesito", "me", "mi", "te", "se", "lo", "la", "el", "en", "de", "un", "y", "o", "a", "es", "son", "si", "no",
  "ok", "listo", "vale", "perfecto", "saber", "quisiera", "podria", "podría", "favor",
]);

// Una sola palabra significativa basta: «¿cuánto vale el capuchino?» es un tema. Los saludos y los
// «ok, gracias» no llegan aquí porque sus palabras están en la lista de vacías.
const MIN_WORDS = 1;
const SIMILARITY = 0.5;
const MAX_EXAMPLES = 3;

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ");

const keywords = (text: string) =>
  new Set(
    normalize(text)
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  );

const jaccard = (a: Set<string>, b: Set<string>) => {
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / (a.size + b.size - shared);
};

interface Group {
  // Firma del mensaje que abrió el grupo. No se amplía al absorber otros: si creciera, el grupo se
  // parecería cada vez menos a sus propias variantes y dejaría fuera a las más largas.
  words: Set<string>;
  messages: { text: string; derived: boolean }[];
}

/** Los temas más preguntados por los clientes en el periodo, con ejemplos reales. */
export async function topics(range: Range = {}, limit = 8): Promise<Topic[]> {
  const rows = await db
    .select({ text: conversationEntries.text, derived: conversations.derived })
    .from(conversationEntries)
    .innerJoin(conversations, eq(conversations.id, conversationEntries.conversationId))
    .where(and(eq(conversationEntries.author, "cliente"), ...inRange(range)));

  const groups: Group[] = [];
  for (const row of rows) {
    const words = keywords(row.text);
    if (words.size < MIN_WORDS) continue;

    const match = groups.find((group) => jaccard(group.words, words) >= SIMILARITY);
    if (match) {
      match.messages.push({ text: row.text, derived: row.derived });
    } else {
      groups.push({ words, messages: [{ text: row.text, derived: row.derived }] });
    }
  }

  return groups
    .map((group) => ({
      // El mensaje más corto del grupo es el que mejor nombra el tema, sin rodeos.
      title: [...group.messages].sort((a, b) => a.text.length - b.text.length)[0].text,
      count: group.messages.length,
      derivedCount: group.messages.filter((message) => message.derived).length,
      examples: group.messages.slice(0, MAX_EXAMPLES).map((message) => message.text),
    }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, limit);
}
