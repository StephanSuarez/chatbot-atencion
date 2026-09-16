// Integración con el servicio de chat falso (plan 009 §9).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "../db";

type SendResult = Awaited<ReturnType<typeof import("../chat/service").sendMessage>>;

const sendMessage = vi.hoisted(() =>
  vi.fn<(input: { message?: unknown; origin?: string }) => Promise<SendResult>>(),
);
vi.mock("../chat/service", () => ({ sendMessage }));

const { runSimulation, startSimulation } = await import("./run");
const { createSimulation, listResults, listQuestions, saveQuestion, summaryOf } = await import("./service");
const { saveClientMessage } = await import("../conversations/service");

// El chat real crea la conversación antes de responder: el doble hace lo mismo, porque el resultado
// guarda su id y la clave foránea exige que exista.
async function conversacionReal() {
  const { conversationId } = await saveClientMessage({
    clientMessageId: crypto.randomUUID(),
    text: "pregunta de simulación",
    origin: "simulacion",
  });
  return conversationId;
}

const respondio = async (text: string): Promise<SendResult> => ({
  ok: true,
  conversationId: await conversacionReal(),
  entries: [{ seq: 1, author: "bot", text, createdAt: new Date() }],
  mode: "ia",
  sources: [],
  pendingInfo: false,
});

const derivo = async (): Promise<SendResult> => ({
  ok: true,
  conversationId: await conversacionReal(),
  entries: [{ seq: 1, author: "bot", text: "Voy a consultar.", createdAt: new Date() }],
  mode: "humano",
  sources: [],
  pendingInfo: false,
});

beforeEach(async () => {
  await sql`delete from simulations; delete from simulation_questions; delete from conversations`.simple();
  sendMessage.mockReset().mockImplementation(() => respondio("A las 7:00."));
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(() => sql.end());

describe("empezar una simulación (FR-012)", () => {
  it("sin preguntas no se puede empezar", async () => {
    expect(await startSimulation()).toEqual({ ok: false, error: expect.stringMatching(/al menos una pregunta/) });
  });

  it("con preguntas devuelve el total que se va a enviar", async () => {
    await saveQuestion({ text: "¿A qué hora abren?", expectation: "responde" });
    await saveQuestion({ text: "¿Tienen wifi?", expectation: "deriva" });

    const started = await startSimulation();
    expect(started).toMatchObject({ ok: true, total: 2 });
  });

  it("no se permiten dos simulaciones a la vez", async () => {
    await saveQuestion({ text: "¿A qué hora abren?", expectation: "responde" });
    await createSimulation(1);

    expect(await startSimulation()).toEqual({ ok: false, error: expect.stringMatching(/ya hay una simulación/i) });
  });
});

describe("ejecutar (FR-002, FR-003, FR-008)", () => {
  it("guarda un resultado por pregunta y evalúa lo esperado", async () => {
    await saveQuestion({ text: "¿A qué hora abren?", expectation: "responde" });
    await saveQuestion({ text: "¿Tienen wifi?", expectation: "deriva" });
    const questions = await listQuestions();

    sendMessage.mockImplementationOnce(() => respondio("Abrimos a las 7:00.")).mockImplementationOnce(() => derivo());
    const id = await createSimulation(questions.length);
    await runSimulation(id, questions, 0);

    const results = await listResults(id);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ answer: "Abrimos a las 7:00.", derived: false, met: true });
    expect(results[1]).toMatchObject({ derived: true, met: true });
    expect(await summaryOf(id)).toMatchObject({ status: "terminada", done: 2, met: 2, failed: 0 });
  });

  it("marca como no cumplida la que se comporta al revés de lo esperado", async () => {
    await saveQuestion({ text: "¿A qué hora abren?", expectation: "responde" });
    sendMessage.mockImplementation(() => derivo());

    const questions = await listQuestions();
    const id = await createSimulation(1);
    await runSimulation(id, questions, 0);

    expect((await listResults(id))[0]).toMatchObject({ derived: true, met: false });
    expect(await summaryOf(id)).toMatchObject({ met: 0 });
  });

  it("cada pregunta va en su propia conversación, sin historial compartido (FR-003)", async () => {
    await saveQuestion({ text: "primera", expectation: "ninguna" });
    await saveQuestion({ text: "segunda", expectation: "ninguna" });

    const id = await createSimulation(2);
    await runSimulation(id, await listQuestions(), 0);

    for (const [call] of sendMessage.mock.calls) {
      expect(call).not.toHaveProperty("conversationId");
      expect(call.origin).toBe("simulacion");
    }
  });

  it("un fallo del proveedor se marca y no tumba el resto (FR-009)", async () => {
    await saveQuestion({ text: "primera", expectation: "responde" });
    await saveQuestion({ text: "segunda", expectation: "responde" });

    sendMessage
      .mockResolvedValueOnce({ ok: false, error: "No pudimos contactar al proveedor." })
      .mockImplementationOnce(() => respondio("Claro que sí."));

    const id = await createSimulation(2);
    await runSimulation(id, await listQuestions(), 0);

    const results = await listResults(id);
    expect(results[0]).toMatchObject({ error: "No pudimos contactar al proveedor.", met: null, answer: null });
    expect(results[1]).toMatchObject({ met: true });
    expect(await summaryOf(id)).toMatchObject({ status: "terminada", done: 2, met: 1, failed: 1 });
  });
});
