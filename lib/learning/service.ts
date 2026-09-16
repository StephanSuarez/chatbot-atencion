import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { saveEntry } from "../kb/service";
import { conversationEntries, knowledgeProposals } from "../schema";

// Reglas de la spec 005 (plan §4). El bot nunca aprende solo: esto solo prepara y guarda propuestas.

const MAX_TITLE = 200;
const MAX_CONTENT = 4000;

export interface Proposal {
  id: string;
  conversationId: string;
  title: string | null;
  content: string | null;
  error: string | null;
  createdAt: Date;
}

export type ApproveResult = { ok: true; entryId: string } | { ok: false; error: string };

/** Solo hay algo que aprender si una persona del equipo escribió en la conversación (FR-001). */
export async function hasTeamMessages(conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversationEntries)
    .where(and(eq(conversationEntries.conversationId, conversationId), eq(conversationEntries.author, "equipo")));
  return row.n > 0;
}

/**
 * Guarda la propuesta. Devuelve false si esa conversación ya tiene una pendiente: el índice único
 * parcial lo garantiza aunque dos llamadas lleguen a la vez (FR-003).
 */
export async function saveProposal(
  conversationId: string,
  proposal: { title: string; content: string } | { error: string },
): Promise<boolean> {
  const values =
    "error" in proposal
      ? { conversationId, error: proposal.error.slice(0, MAX_CONTENT) }
      : {
          conversationId,
          title: proposal.title.trim().slice(0, MAX_TITLE),
          content: proposal.content.trim().slice(0, MAX_CONTENT),
        };
  const saved = await db.insert(knowledgeProposals).values(values).onConflictDoNothing().returning({ id: knowledgeProposals.id });
  return saved.length > 0;
}

export function listPendingProposals(): Promise<Proposal[]> {
  return db
    .select({
      id: knowledgeProposals.id,
      conversationId: knowledgeProposals.conversationId,
      title: knowledgeProposals.title,
      content: knowledgeProposals.content,
      error: knowledgeProposals.error,
      createdAt: knowledgeProposals.createdAt,
    })
    .from(knowledgeProposals)
    .where(eq(knowledgeProposals.status, "pendiente"))
    .orderBy(desc(knowledgeProposals.createdAt));
}

export async function countPendingProposals(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(knowledgeProposals)
    .where(eq(knowledgeProposals.status, "pendiente"));
  return row.n;
}

/** Aprobar crea la entrada con lo que dejó escrito la persona, no con lo que propuso el modelo (FR-005). */
export async function approveProposal(id: string, edited: { title: string; content: string }): Promise<ApproveResult> {
  const [proposal] = await db
    .select({ conversationId: knowledgeProposals.conversationId })
    .from(knowledgeProposals)
    .where(and(eq(knowledgeProposals.id, id), eq(knowledgeProposals.status, "pendiente")));
  if (!proposal) return { ok: false, error: "Esa propuesta ya no está pendiente." };

  const entry = await saveEntry({
    title: edited.title,
    content: edited.content,
    learnedFromConversationId: proposal.conversationId,
  });
  if (!entry.ok) return { ok: false, error: entry.errors.title ?? entry.errors.content ?? "No se pudo guardar." };

  await db.update(knowledgeProposals).set({ status: "aprobada" }).where(eq(knowledgeProposals.id, id));
  return { ok: true, entryId: entry.id };
}

/** Descartar cierra la propuesta; esa conversación no vuelve a proponer nada (FR-007). */
export async function discardProposal(id: string): Promise<boolean> {
  const discarded = await db
    .update(knowledgeProposals)
    .set({ status: "descartada" })
    .where(and(eq(knowledgeProposals.id, id), eq(knowledgeProposals.status, "pendiente")))
    .returning({ id: knowledgeProposals.id });
  return discarded.length > 0;
}

/** Una conversación que ya propuso algo (aprobado o descartado) no vuelve a proponer (FR-007). */
export async function alreadyProposed(conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(knowledgeProposals)
    .where(eq(knowledgeProposals.conversationId, conversationId));
  return row.n > 0;
}
