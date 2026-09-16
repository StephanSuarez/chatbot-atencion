import { randomUUID } from "node:crypto";
import { sendMessage } from "../chat/service";
import {
  createSimulation,
  finishSimulation,
  listQuestions,
  meets,
  runningSimulation,
  saveResult,
  type Question,
} from "./service";

// Ejecuta la simulación contra el chatbot real (plan 009 §3). Pensado para correr en segundo plano
// con after(): diez preguntas con pausas tardan más de lo que aguanta una petición.

// Los modelos gratuitos cortan por frecuencia: se aprendió corriendo las evaluaciones de la 004 y la 005.
export const PAUSE_MS = 3000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type StartResult = { ok: true; id: string; total: number } | { ok: false; error: string };

/** Crea la simulación y devuelve su id. La ejecución en sí va aparte, en segundo plano. */
export async function startSimulation(): Promise<StartResult> {
  if (await runningSimulation()) return { ok: false, error: "Ya hay una simulación en curso. Espera a que termine." };

  const questions = await listQuestions();
  if (!questions.length) return { ok: false, error: "Agrega al menos una pregunta de prueba." };

  const id = await createSimulation(questions.length);
  return { ok: true, id, total: questions.length };
}

/** Recorre las preguntas, una conversación por cada una, y guarda el resultado de todas. */
export async function runSimulation(simulationId: string, questions: Question[], pause = PAUSE_MS): Promise<void> {
  const started = Date.now();
  let failed = 0;

  for (const [index, question] of questions.entries()) {
    // Cada pregunta arranca limpia: sin conversationId no hay historial compartido (FR-003).
    const sent = await sendMessage({ clientMessageId: randomUUID(), message: question.text, origin: "simulacion" });

    if (!sent.ok) {
      failed++;
      await saveResult(simulationId, {
        question: question.text,
        expectation: question.expectation,
        answer: null,
        derived: false,
        met: meets(question.expectation, { derived: false, failed: true }),
        error: sent.error,
        conversationId: sent.conversationId ?? null,
      });
    } else {
      const derived = sent.mode === "humano";
      await saveResult(simulationId, {
        question: question.text,
        expectation: question.expectation,
        answer: sent.entries.map((entry) => entry.text).join(" ") || null,
        derived,
        met: meets(question.expectation, { derived, failed: false }),
        error: null,
        conversationId: sent.conversationId,
      });
    }

    if (index < questions.length - 1) await wait(pause);
  }

  await finishSimulation(simulationId);
  console.info(`[simulacion] ${simulationId}: ${questions.length} preguntas, ${failed} fallos del proveedor, ${Date.now() - started} ms`);
}
