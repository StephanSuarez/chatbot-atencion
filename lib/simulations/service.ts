import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { simulationQuestions, simulationResults, simulations } from "../schema";

// Preguntas de prueba, simulaciones y sus informes (plan 009 §5). No ejecuta nada: eso es run.ts.

export type Expectation = "responde" | "deriva" | "ninguna";
export type SimulationStatus = "en_curso" | "terminada" | "interrumpida";

export const MAX_QUESTION = 1000;
// Una simulación en curso sin avanzar durante este tiempo se considera interrumpida (plan §8).
const STALE_MS = 10 * 60 * 1000;

export interface Question {
  id: string;
  text: string;
  expectation: Expectation;
}

export interface ResultRow {
  question: string;
  expectation: Expectation;
  answer: string | null;
  derived: boolean;
  met: boolean | null;
  error: string | null;
  conversationId: string | null;
}

export interface SimulationSummary {
  id: string;
  status: SimulationStatus;
  total: number;
  done: number;
  met: number;
  failed: number;
  createdAt: Date;
}

export type QuestionResult = { ok: true; id: string } | { ok: false; error: string };

// ---------- Preguntas ----------

export function listQuestions(): Promise<Question[]> {
  return db
    .select({ id: simulationQuestions.id, text: simulationQuestions.text, expectation: simulationQuestions.expectation })
    .from(simulationQuestions)
    .orderBy(asc(simulationQuestions.createdAt));
}

export async function saveQuestion(input: { id?: string; text: string; expectation: Expectation }): Promise<QuestionResult> {
  const text = input.text.trim().slice(0, MAX_QUESTION);
  if (!text) return { ok: false, error: "Escribe la pregunta." };

  const values = { text, expectation: input.expectation };
  const [saved] = input.id
    ? await db.update(simulationQuestions).set(values).where(eq(simulationQuestions.id, input.id)).returning()
    : await db.insert(simulationQuestions).values(values).returning();
  return saved ? { ok: true, id: saved.id } : { ok: false, error: "Esa pregunta ya no existe." };
}

export async function deleteQuestion(id: string): Promise<void> {
  await db.delete(simulationQuestions).where(eq(simulationQuestions.id, id));
}

// ---------- Simulaciones ----------

/** Solo puede haber una simulación corriendo a la vez (plan §8). */
export async function runningSimulation(now = new Date()): Promise<SimulationSummary | null> {
  const [row] = await db.select().from(simulations).where(eq(simulations.status, "en_curso")).limit(1);
  if (!row) return null;
  if (now.getTime() - row.updatedAt.getTime() > STALE_MS) {
    await db.update(simulations).set({ status: "interrumpida" }).where(eq(simulations.id, row.id));
    return null;
  }
  return summaryOf(row.id);
}

export async function createSimulation(total: number): Promise<string> {
  const [created] = await db.insert(simulations).values({ total }).returning({ id: simulations.id });
  return created.id;
}

export async function saveResult(
  simulationId: string,
  result: Omit<ResultRow, "met"> & { met: boolean | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(simulationResults).values({ simulationId, ...result });
    await tx
      .update(simulations)
      .set({ done: sql`${simulations.done} + 1`, updatedAt: new Date() })
      .where(eq(simulations.id, simulationId));
  });
}

export async function finishSimulation(id: string): Promise<void> {
  await db.update(simulations).set({ status: "terminada", updatedAt: new Date() }).where(eq(simulations.id, id));
}

/** Compara lo que hizo el bot con lo que se esperaba. Un fallo del proveedor no cuenta (FR-009). */
export function meets(expectation: Expectation, outcome: { derived: boolean; failed: boolean }): boolean | null {
  if (outcome.failed || expectation === "ninguna") return null;
  return expectation === "deriva" ? outcome.derived : !outcome.derived;
}

export async function listSimulations(limit = 10): Promise<SimulationSummary[]> {
  const rows = await db.select({ id: simulations.id }).from(simulations).orderBy(desc(simulations.createdAt)).limit(limit);
  return Promise.all(rows.map((row) => summaryOf(row.id))).then((list) => list.filter((item): item is SimulationSummary => !!item));
}

export async function summaryOf(id: string): Promise<SimulationSummary | null> {
  const [row] = await db.select().from(simulations).where(eq(simulations.id, id));
  if (!row) return null;

  const [counts] = await db
    .select({
      met: sql<number>`count(*) filter (where ${simulationResults.met})::int`,
      failed: sql<number>`count(*) filter (where ${simulationResults.error} is not null)::int`,
    })
    .from(simulationResults)
    .where(eq(simulationResults.simulationId, id));

  return { id: row.id, status: row.status, total: row.total, done: row.done, met: counts.met, failed: counts.failed, createdAt: row.createdAt };
}

export function listResults(simulationId: string): Promise<ResultRow[]> {
  return db
    .select({
      question: simulationResults.question,
      expectation: simulationResults.expectation,
      answer: simulationResults.answer,
      derived: simulationResults.derived,
      met: simulationResults.met,
      error: simulationResults.error,
      conversationId: simulationResults.conversationId,
    })
    .from(simulationResults)
    .where(eq(simulationResults.simulationId, simulationId))
    .orderBy(asc(simulationResults.createdAt));
}

/** Marca como interrumpidas las simulaciones que quedaron colgadas (por ejemplo, al reiniciar el servidor). */
export async function markStale(now = new Date()): Promise<number> {
  const stale = await db
    .update(simulations)
    .set({ status: "interrumpida" })
    .where(and(eq(simulations.status, "en_curso"), lt(simulations.updatedAt, new Date(now.getTime() - STALE_MS))))
    .returning({ id: simulations.id });
  return stale.length;
}
