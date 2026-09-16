// Integración contra la base de tests (plan 004 §10).
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "../db";
import {
  countPending,
  deleteConversation,
  getAttachment,
  getConversation,
  getEntries,
  listConversations,
  saveBotTurn,
  saveClientMessage,
  saveTeamReply,
  setMode,
  type NewAttachment,
} from "./service";

beforeEach(async () => {
  await sql`delete from conversations`;
});
afterAll(() => sql.end());

const newMessage = (text: string, conversationId?: string) =>
  saveClientMessage({ conversationId, clientMessageId: randomUUID(), text });

const authors = async (id: string, forClient = false) => (await getEntries(id, { forClient }))?.map((e) => e.author);

describe("guardar mensajes del cliente (FR-001, FR-002)", () => {
  it("el primer mensaje crea la conversación en modo IA, origen chat de prueba", async () => {
    const { conversationId } = await newMessage("¿A qué hora abren?");
    expect(await getConversation(conversationId)).toMatchObject({
      origin: "chat_de_prueba",
      mode: "ia",
      derived: false,
      pending: false,
      personRequests: 0,
    });
    expect(await getEntries(conversationId, { forClient: true })).toEqual([
      expect.objectContaining({ author: "cliente", text: "¿A qué hora abren?" }),
    ]);
  });

  it("los siguientes mensajes van a la misma conversación, en orden", async () => {
    const first = await newMessage("hola");
    const second = await newMessage("¿abren el sábado?", first.conversationId);
    expect(second.conversationId).toBe(first.conversationId);
    expect((await getEntries(first.conversationId, { forClient: true }))?.map((e) => e.text)).toEqual(["hola", "¿abren el sábado?"]);
  });

  it("reintentar el mismo mensaje no lo duplica", async () => {
    const clientMessageId = randomUUID();
    const first = await saveClientMessage({ clientMessageId, text: "hola" });
    const retry = await saveClientMessage({ conversationId: first.conversationId, clientMessageId, text: "hola" });
    expect(retry).toEqual({ conversationId: first.conversationId, seq: first.seq, duplicate: true });
    expect(await authors(first.conversationId)).toEqual(["cliente"]);
  });

  it("un reintento sin id de conversación no deja una conversación vacía", async () => {
    const clientMessageId = randomUUID();
    const first = await saveClientMessage({ clientMessageId, text: "hola" });
    const retry = await saveClientMessage({ clientMessageId, text: "hola" });
    expect(retry.conversationId).toBe(first.conversationId);
    expect(await listConversations()).toHaveLength(1);
  });

  it("si la conversación ya no existe (borrada o id inválido) empieza una nueva", async () => {
    const gone = await newMessage("hola");
    await deleteConversation(gone.conversationId);
    const next = await newMessage("sigo aquí", gone.conversationId);
    expect(next.conversationId).not.toBe(gone.conversationId);
    expect((await newMessage("x", "no-es-un-uuid")).duplicate).toBe(false);
  });
});

describe("turno del bot y modo (FR-010, FR-014…FR-016)", () => {
  it("guarda la respuesta del bot en modo IA", async () => {
    const { conversationId } = await newMessage("hola");
    expect(await saveBotTurn(conversationId, { entries: [{ author: "bot", text: "¡Hola!" }] })).toBe(true);
    expect(await authors(conversationId)).toEqual(["cliente", "bot"]);
  });

  it("derivar pasa a modo humano, marca derivada y la deja pendiente", async () => {
    const { conversationId } = await newMessage("¿tienen leche de almendras?");
    await saveBotTurn(conversationId, {
      entries: [
        { author: "bot", text: "No tengo esa información, voy a consultar." },
        { author: "nota", text: "Preguntó por leche de almendras." },
        { author: "evento", text: "El bot pasó la conversación a modo humano." },
      ],
      toHuman: true,
    });
    expect(await getConversation(conversationId)).toMatchObject({ mode: "humano", derived: true, pending: false });

    await newMessage("¿entonces?", conversationId);
    expect(await getConversation(conversationId)).toMatchObject({ pending: true });
    expect(await countPending()).toBe(1);
  });

  it("descarta la respuesta del bot si el equipo tomó la conversación mientras respondía", async () => {
    const { conversationId } = await newMessage("hola");
    await setMode(conversationId, "humano");
    expect(await saveBotTurn(conversationId, { entries: [{ author: "bot", text: "tarde" }] })).toBe(false);
    expect(await authors(conversationId)).toEqual(["cliente", "evento"]);
  });

  it("guarda el conteo de pedidos de persona, y activar la IA lo reinicia", async () => {
    const { conversationId } = await newMessage("quiero una persona");
    await saveBotTurn(conversationId, { entries: [{ author: "bot", text: "Te ayudo yo." }], personRequests: 1 });
    expect((await getConversation(conversationId))?.personRequests).toBe(1);

    await setMode(conversationId, "humano");
    await setMode(conversationId, "ia");
    expect(await getConversation(conversationId)).toMatchObject({ mode: "ia", personRequests: 0 });
    expect(await authors(conversationId)).toEqual(["cliente", "bot", "evento", "evento"]);
  });

  it("cambiar al mismo modo no registra un evento nuevo", async () => {
    const { conversationId } = await newMessage("hola");
    expect(await setMode(conversationId, "ia")).toBe(true);
    expect(await authors(conversationId)).toEqual(["cliente"]);
  });
});

describe("respuestas del equipo (FR-017, FR-018)", () => {
  it("solo se puede responder en modo humano; responder deja de estar pendiente", async () => {
    const { conversationId } = await newMessage("hola");
    expect(await saveTeamReply(conversationId, "Hola, soy Ana")).toBe(false);

    await setMode(conversationId, "humano");
    expect(await countPending()).toBe(1);
    expect(await saveTeamReply(conversationId, "Hola, soy Ana")).toBe(true);
    expect(await countPending()).toBe(0);
  });
});

describe("lo que ve el cliente (SC-009)", () => {
  it("nunca incluye notas ni eventos, y trae solo lo nuevo desde un punto", async () => {
    const { conversationId, seq } = await newMessage("¿leche de almendras?");
    await saveBotTurn(conversationId, {
      entries: [
        { author: "bot", text: "Voy a consultar." },
        { author: "nota", text: "nota interna" },
        { author: "evento", text: "evento interno" },
      ],
      toHuman: true,
    });
    await saveTeamReply(conversationId, "Sí tenemos.");

    expect((await getEntries(conversationId, { forClient: true }))?.map((e) => e.author)).toEqual(["cliente", "bot", "equipo"]);
    expect((await getEntries(conversationId, { forClient: true, after: seq }))?.map((e) => e.text)).toEqual([
      "Voy a consultar.",
      "Sí tenemos.",
    ]);
    expect(await authors(conversationId)).toEqual(["cliente", "bot", "nota", "evento", "equipo"]);
  });

  it("una conversación que no existe devuelve null", async () => {
    expect(await getEntries(randomUUID(), { forClient: true })).toBeNull();
  });
});

describe("lista y filtros (FR-019, FR-020)", () => {
  const at = (id: string, iso: string) => sql`update conversations set last_message_at = ${iso} where id = ${id}`;

  it("pendientes primero, luego de la más reciente a la más antigua", async () => {
    const old = (await newMessage("vieja")).conversationId;
    const recent = (await newMessage("reciente")).conversationId;
    const waiting = (await newMessage("espera")).conversationId;
    await at(old, "2026-09-01T10:00:00Z");
    await at(recent, "2026-09-10T10:00:00Z");
    await setMode(waiting, "humano");
    await at(waiting, "2026-08-01T10:00:00Z");

    expect((await listConversations()).map((c) => c.id)).toEqual([waiting, recent, old]);
  });

  it("filtra por rango de fechas del último mensaje y por tipo", async () => {
    const derived = (await newMessage("a")).conversationId;
    await saveBotTurn(derived, { entries: [{ author: "bot", text: "consulto" }], toHuman: true });
    const plain = (await newMessage("b")).conversationId;
    await at(derived, "2026-09-05T12:00:00Z");
    await at(plain, "2026-09-12T12:00:00Z");

    const range = await listConversations({ from: new Date("2026-09-05T00:00:00Z"), to: new Date("2026-09-06T00:00:00Z") });
    expect(range.map((c) => c.id)).toEqual([derived]);
    expect((await listConversations({ type: "derivadas" })).map((c) => c.id)).toEqual([derived]);
    expect((await listConversations({ type: "sin_derivar" })).map((c) => c.id)).toEqual([plain]);
    expect(await listConversations({ from: new Date("2027-01-01T00:00:00Z") })).toEqual([]);
  });
});

describe("borrar (FR-006)", () => {
  it("borra la conversación y sus entradas", async () => {
    const { conversationId } = await newMessage("hola");
    expect(await deleteConversation(conversationId)).toBe(true);
    expect(await getConversation(conversationId)).toBeNull();
    const [{ n }] = await sql`select count(*)::int as n from conversation_entries`;
    expect(n).toBe(0);
  });

  it("una conversación pendiente no se puede borrar", async () => {
    const { conversationId } = await newMessage("hola");
    await setMode(conversationId, "humano");
    expect(await deleteConversation(conversationId)).toBe(false);
    expect(await getConversation(conversationId)).not.toBeNull();
  });
});

describe("adjuntos (010)", () => {
  const foto: NewAttachment = {
    name: "recibo.png",
    category: "imagen",
    contentType: "image/png",
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0x42]),
  };

  const conAdjunto = (text: string, attachment: NewAttachment = foto) =>
    saveClientMessage({ clientMessageId: randomUUID(), text, attachment });

  const count = async (table: "conversation_attachments" | "conversation_entries") =>
    (await sql`select count(*)::int as n from ${sql(table)}`)[0].n;

  it("el mensaje lleva la ficha del adjunto, sin los bytes", async () => {
    const { conversationId } = await conAdjunto("mira esto");
    const [entry] = (await getEntries(conversationId, { forClient: true }))!;

    expect(entry.text).toBe("mira esto");
    expect(entry.attachment).toEqual({
      id: expect.any(String),
      name: "recibo.png",
      category: "imagen",
      contentType: "image/png",
      sizeBytes: foto.data.length,
    });
  });

  it("los bytes se leen aparte y vuelven idénticos", async () => {
    const { conversationId } = await conAdjunto("mira esto");
    const [entry] = (await getEntries(conversationId, { forClient: true }))!;

    const stored = await getAttachment(entry.attachment!.id);
    expect(stored).toMatchObject({ name: "recibo.png", contentType: "image/png", category: "imagen" });
    expect(stored!.data).toEqual(foto.data);
  });

  it("un mensaje sin adjunto no trae ficha", async () => {
    const { conversationId } = await newMessage("solo texto");
    const [entry] = (await getEntries(conversationId, { forClient: true }))!;
    expect(entry.attachment).toBeUndefined();
  });

  it("un mensaje solo con archivo, sin texto, es válido", async () => {
    const { conversationId } = await conAdjunto("");
    const [entry] = (await getEntries(conversationId, { forClient: true }))!;
    expect(entry.text).toBe("");
    expect(entry.attachment?.name).toBe("recibo.png");
  });

  it("reintentar el mismo mensaje no duplica el adjunto", async () => {
    const clientMessageId = randomUUID();
    const first = await saveClientMessage({ clientMessageId, text: "mira", attachment: foto });
    const retry = await saveClientMessage({ clientMessageId, text: "mira", attachment: foto });

    expect(retry).toMatchObject({ conversationId: first.conversationId, duplicate: true });
    expect(await count("conversation_attachments")).toBe(1);
    expect(await count("conversation_entries")).toBe(1);
  });

  it("el equipo puede responder con un archivo", async () => {
    const { conversationId } = await newMessage("¿me mandas la factura?");
    await setMode(conversationId, "humano");

    const pdf: NewAttachment = {
      name: "factura.pdf",
      category: "documento",
      contentType: "application/pdf",
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    };
    expect(await saveTeamReply(conversationId, "Aquí la tienes", pdf)).toBe(true);

    const entries = (await getEntries(conversationId, { forClient: true }))!;
    const reply = entries.at(-1)!;
    expect(reply).toMatchObject({ author: "equipo", text: "Aquí la tienes" });
    expect(reply.attachment).toMatchObject({ name: "factura.pdf", category: "documento" });
  });

  it("borrar la conversación borra sus adjuntos (FR-012)", async () => {
    const { conversationId } = await conAdjunto("mira esto");
    expect(await count("conversation_attachments")).toBe(1);

    expect(await deleteConversation(conversationId)).toBe(true);
    expect(await count("conversation_attachments")).toBe(0);
  });
});
