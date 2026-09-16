// Integración contra la base de tests (plan 008 §9).
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { saveBotTurn, saveClientMessage, setMode, type Mode } from "../conversations/service";
import { sql } from "../db";
import { handoffReasons, summary, topics } from "./service";

beforeEach(async () => {
  // Se limpia también lo de simulaciones: sus conversaciones contarían en estas métricas.
  await sql`delete from simulations; delete from simulation_questions; delete from conversations`.simple();
});
afterAll(() => sql.end());

/** Una conversación con su mensaje del cliente y, si se pide, su derivación. */
async function conversation(text: string, options: { reason?: "no_sabe" | "enojo" | "pide_persona"; mode?: Mode } = {}) {
  const { conversationId } = await saveClientMessage({ clientMessageId: randomUUID(), text });
  if (options.reason) {
    await saveBotTurn(conversationId, {
      entries: [{ author: "bot", text: "Voy a consultar." }],
      toHuman: true,
      handoffReason: options.reason,
    });
  } else {
    await saveBotTurn(conversationId, { entries: [{ author: "bot", text: "Claro que sí." }] });
  }
  if (options.mode === "ia") await setMode(conversationId, "ia");
  return conversationId;
}

describe("resumen del periodo (FR-002, FR-003)", () => {
  it("cuenta totales, resueltas por el bot, derivadas y pendientes", async () => {
    await conversation("¿A qué hora abren?");
    await conversation("¿Cuánto vale el capuchino?");
    await conversation("¿Tienen wifi?", { reason: "no_sabe" });

    expect(await summary()).toEqual({ total: 3, solvedByBot: 2, derived: 1, pending: 0, resolutionRate: 67 });
  });

  it("una derivada que espera respuesta cuenta como pendiente", async () => {
    const id = await conversation("¿Tienen wifi?", { reason: "no_sabe" });
    await saveClientMessage({ conversationId: id, clientMessageId: randomUUID(), text: "¿Hola?" });

    expect(await summary()).toMatchObject({ derived: 1, pending: 1 });
  });

  it("sin conversaciones, el porcentaje es cero y no revienta", async () => {
    expect(await summary()).toEqual({ total: 0, solvedByBot: 0, derived: 0, pending: 0, resolutionRate: 0 });
  });

  it("el periodo acota los números (FR-001)", async () => {
    const viejo = await conversation("pregunta vieja");
    await sql`update conversations set last_message_at = '2026-01-01T10:00:00Z' where id = ${viejo}`;
    await conversation("pregunta de hoy");

    expect(await summary({ from: new Date("2026-09-01T00:00:00Z") })).toMatchObject({ total: 1 });
    expect(await summary()).toMatchObject({ total: 2 });
  });
});

describe("motivos de derivación (FR-007)", () => {
  it("agrupa por motivo y deja aparte las que no lo tienen registrado", async () => {
    await conversation("¿tienen wifi?", { reason: "no_sabe" });
    await conversation("esto es un desastre", { reason: "enojo" });
    await conversation("quiero una persona", { reason: "pide_persona" });
    await conversation("¿y parqueadero?", { reason: "no_sabe" });

    // Una derivación vieja, anterior a la columna.
    const sinMotivo = await conversation("pregunta antigua", { reason: "no_sabe" });
    await sql`update conversations set handoff_reason = null where id = ${sinMotivo}`;

    expect(await handoffReasons()).toEqual({ no_sabe: 2, enojo: 1, pide_persona: 1, sin_registrar: 1 });
  });

  it("las conversaciones que no derivaron no entran en el desglose", async () => {
    await conversation("¿A qué hora abren?");
    expect(await handoffReasons()).toEqual({ no_sabe: 0, enojo: 0, pide_persona: 0, sin_registrar: 0 });
  });
});

describe("temas más preguntados (FR-004…FR-006)", () => {
  it("agrupa preguntas que dicen lo mismo con palabras distintas", async () => {
    await conversation("¿Tienen sillas altas para bebés?");
    await conversation("Hola, ¿hay sillas altas para bebés en el local?");
    await conversation("¿Cuánto vale el capuchino?");

    const found = await topics();
    expect(found[0]).toMatchObject({ count: 2, title: "¿Tienen sillas altas para bebés?" });
    expect(found[0].examples).toHaveLength(2);
    expect(found).toHaveLength(2);
  });

  it("señala cuántas de un tema terminaron derivadas", async () => {
    await conversation("¿Tienen sillas altas para bebés?", { reason: "no_sabe" });
    await conversation("¿Hay sillas altas para bebés?", { reason: "no_sabe" });

    const [tema] = await topics();
    expect(tema).toMatchObject({ count: 2, derivedCount: 2 });
  });

  it("descarta saludos y mensajes sin contenido propio", async () => {
    await conversation("hola");
    await conversation("gracias");
    await conversation("ok listo");

    expect(await topics()).toEqual([]);
  });

  it("ordena por cuántas veces se preguntó y respeta el límite", async () => {
    await conversation("¿Cuánto cuesta el domicilio?");
    await conversation("¿Cuánto cuesta el domicilio a mi casa?");
    await conversation("¿Cuánto cuesta el domicilio hasta Palermo?");
    await conversation("¿Hacen pedidos para eventos?");

    const found = await topics({}, 1);
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(3);
  });
});
