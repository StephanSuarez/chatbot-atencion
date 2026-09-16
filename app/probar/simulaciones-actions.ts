"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getConfig } from "../../lib/config-service";
import { runSimulation, startSimulation } from "../../lib/simulations/run";
import {
  deleteQuestion,
  listResults,
  saveQuestion,
  summaryOf,
  type Expectation,
  type ResultRow,
  type SimulationSummary,
} from "../../lib/simulations/service";

// Simulaciones (009). Sin login (principio 11): el servicio valida todo lo que llega.

const PATH = "/probar";
const EXPECTATIONS: Expectation[] = ["responde", "deriva", "ninguna"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActionResult = { ok: boolean; error?: string };

const logError = (what: string, e: unknown) => console.error(`[simulacion] ${what}:`, e instanceof Error ? e.message : e);

export async function saveQuestionAction(input: { id?: string; text: string; expectation: string }): Promise<ActionResult> {
  const expectation = EXPECTATIONS.find((option) => option === input?.expectation) ?? "ninguna";
  const id = typeof input?.id === "string" && UUID.test(input.id) ? input.id : undefined;
  try {
    const saved = await saveQuestion({ id, text: String(input?.text ?? ""), expectation });
    if (!saved.ok) return { ok: false, error: saved.error };
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    logError("no se pudo guardar la pregunta", e);
    return { ok: false, error: "No pudimos guardarla. Intenta de nuevo." };
  }
}

export async function deleteQuestionAction(id: unknown): Promise<ActionResult> {
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false };
  try {
    await deleteQuestion(id);
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    logError("no se pudo borrar la pregunta", e);
    return { ok: false, error: "No pudimos borrarla. Intenta de nuevo." };
  }
}

/**
 * Empieza la simulación y sigue en segundo plano: con las pausas entre preguntas tarda más de lo
 * que aguanta una petición (plan §3). La pantalla consulta el avance.
 */
export async function runSimulationAction(): Promise<{ ok: true; id: string; total: number } | { ok: false; error: string }> {
  const config = await getConfig();
  if (!config.complete) return { ok: false, error: "Tu chatbot todavía no está listo: completa su configuración." };

  try {
    const started = await startSimulation();
    if (!started.ok) return started;

    after(() => runSimulation(started.id, started.questions).catch((e) => logError("falló la simulación", e)));
    revalidatePath(PATH);
    return { ok: true, id: started.id, total: started.total };
  } catch (e) {
    logError("no se pudo empezar la simulación", e);
    return { ok: false, error: "No pudimos empezar la simulación. Intenta de nuevo." };
  }
}

/** Avance y resultados de una simulación, para consultar mientras corre y al terminar. */
export async function simulationStateAction(
  id: unknown,
): Promise<{ summary: SimulationSummary; results: ResultRow[] } | null> {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const summary = await summaryOf(id);
  if (!summary) return null;
  return { summary, results: await listResults(id) };
}
