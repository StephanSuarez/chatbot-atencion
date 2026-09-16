// Integración contra la base de tests (plan 009 §9).
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { countPending, saveClientMessage, saveBotTurn, setMode } from "../conversations/service";
import { db, sql } from "../db";
import { conversations } from "../schema";
import {
  createSimulation,
  deleteQuestion,
  finishSimulation,
  listQuestions,
  listResults,
  listSimulations,
  markStale,
  meets,
  runningSimulation,
  saveQuestion,
  saveResult,
  summaryOf,
} from "./service";

beforeEach(async () => {
  await sql`delete from simulations; delete from simulation_questions; delete from conversations`.simple();
});
afterAll(() => sql.end());

describe("preguntas de prueba (FR-001)", () => {
  it("guarda, edita y borra", async () => {
    const created = await saveQuestion({ text: "  ¿A qué hora abren?  ", expectation: "responde" });
    if (!created.ok) throw new Error(created.error);
    expect(await listQuestions()).toEqual([{ id: created.id, text: "¿A qué hora abren?", expectation: "responde" }]);

    await saveQuestion({ id: created.id, text: "¿A qué hora abren los sábados?", expectation: "responde" });
    expect((await listQuestions())[0].text).toBe("¿A qué hora abren los sábados?");

    await deleteQuestion(created.id);
    expect(await listQuestions()).toEqual([]);
  });

  it("rechaza una pregunta vacía", async () => {
    expect(await saveQuestion({ text: "   ", expectation: "ninguna" })).toEqual({ ok: false, error: expect.any(String) });
    expect(await listQuestions()).toEqual([]);
  });

  it("editar una pregunta que ya no existe lo dice", async () => {
    const result = await saveQuestion({ id: randomUUID(), text: "hola", expectation: "ninguna" });
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe("expectativas (HU-3, FR-009)", () => {
  it.each([
    ["espera responder y respondió", "responde", { derived: false, failed: false }, true],
    ["espera responder y derivó", "responde", { derived: true, failed: false }, false],
    ["espera derivar y derivó", "deriva", { derived: true, failed: false }, true],
    ["espera derivar y respondió", "deriva", { derived: false, failed: false }, false],
  ] as const)("%s", (_, expectation, outcome, expected) => {
    expect(meets(expectation, outcome)).toBe(expected);
  });

  it("un fallo del proveedor no cuenta ni a favor ni en contra", () => {
    expect(meets("deriva", { derived: false, failed: true })).toBeNull();
  });

  it("sin expectativa no se juzga", () => {
    expect(meets("ninguna", { derived: true, failed: false })).toBeNull();
  });
});

describe("informes (FR-007, FR-008, FR-010)", () => {
  it("cuenta cumplidas y fallidas, y avanza el contador", async () => {
    const id = await createSimulation(3);
    await saveResult(id, {
      question: "¿A qué hora abren?",
      expectation: "responde",
      answer: "A las 7:00.",
      derived: false,
      met: true,
      error: null,
      conversationId: null,
    });
    await saveResult(id, {
      question: "¿Tienen wifi?",
      expectation: "deriva",
      answer: null,
      derived: false,
      met: null,
      error: "El proveedor no respondió.",
      conversationId: null,
    });
    await saveResult(id, {
      question: "¿Tienen parqueadero?",
      expectation: "responde",
      answer: "Voy a consultar.",
      derived: true,
      met: false,
      error: null,
      conversationId: null,
    });
    await finishSimulation(id);

    expect(await summaryOf(id)).toMatchObject({ status: "terminada", total: 3, done: 3, met: 1, failed: 1 });
    expect((await listResults(id)).map((r) => r.question)).toEqual([
      "¿A qué hora abren?",
      "¿Tienen wifi?",
      "¿Tienen parqueadero?",
    ]);
  });

  it("el informe conserva la pregunta aunque se borre después", async () => {
    const question = await saveQuestion({ text: "¿Tienen wifi?", expectation: "deriva" });
    if (!question.ok) throw new Error(question.error);
    const id = await createSimulation(1);
    await saveResult(id, {
      question: "¿Tienen wifi?",
      expectation: "deriva",
      answer: "Voy a consultar.",
      derived: true,
      met: true,
      error: null,
      conversationId: null,
    });

    await deleteQuestion(question.id);
    expect((await listResults(id))[0].question).toBe("¿Tienen wifi?");
  });

  it("lista los informes, el más reciente primero", async () => {
    const primera = await createSimulation(1);
    await finishSimulation(primera);
    const segunda = await createSimulation(2);

    const found = await listSimulations();
    expect(found.map((s) => s.id)).toEqual([segunda, primera]);
  });
});

describe("una simulación a la vez (plan §8)", () => {
  it("detecta la que está corriendo", async () => {
    const id = await createSimulation(2);
    expect(await runningSimulation()).toMatchObject({ id, status: "en_curso" });

    await finishSimulation(id);
    expect(await runningSimulation()).toBeNull();
  });

  it("una en curso que lleva mucho sin avanzar se marca interrumpida", async () => {
    const id = await createSimulation(5);
    await sql`update simulations set updated_at = now() - interval '20 minutes' where id = ${id}`;

    expect(await runningSimulation()).toBeNull();
    expect(await summaryOf(id)).toMatchObject({ status: "interrumpida" });
  });

  it("markStale cierra las que quedaron colgadas", async () => {
    const id = await createSimulation(5);
    await sql`update simulations set updated_at = now() - interval '30 minutes' where id = ${id}`;
    expect(await markStale()).toBe(1);
  });
});

describe("las simulaciones no ensucian los pendientes (FR-005)", () => {
  it("una conversación de simulación derivada no cuenta como pendiente", async () => {
    const { conversationId } = await saveClientMessage({ clientMessageId: randomUUID(), text: "¿Tienen wifi?" });
    await db.update(conversations).set({ origin: "simulacion" }).where(eq(conversations.id, conversationId));
    await saveBotTurn(conversationId, { entries: [{ author: "bot", text: "Voy a consultar." }], toHuman: true });
    await saveClientMessage({ conversationId, clientMessageId: randomUUID(), text: "¿Hola?" });

    expect(await countPending()).toBe(0);
  });

  it("una del chat de prueba en las mismas condiciones sí cuenta", async () => {
    const { conversationId } = await saveClientMessage({ clientMessageId: randomUUID(), text: "¿Tienen wifi?" });
    await setMode(conversationId, "humano");
    await saveClientMessage({ conversationId, clientMessageId: randomUUID(), text: "¿Hola?" });

    expect(await countPending()).toBe(1);
  });
});
