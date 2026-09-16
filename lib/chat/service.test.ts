// Integración: reglas del servicio contra la base de tests, con proveedor y buscador falsos.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "../db";
import { ProviderError, type ChatMessage, type ChatResult, type Tool } from "../providers";
import { getConversation, getEntries, saveTeamReply, setMode } from "../conversations/service";

const fake = vi.hoisted(() => ({
  config: {} as { companyName: string; prompt: string; model: string | null; complete: boolean; missing: string[] },
  credentials: null as unknown,
  pending: 0,
}));

const chat = vi.fn<(messages: ChatMessage[], model: string, key: string, tools?: Tool[]) => Promise<ChatResult>>();
const provider = { id: "fake", name: "Fake", chat };

vi.mock("../config-service", () => ({
  FIXED_RULES: ["No inventa respuestas."],
  getConfig: async () => fake.config,
  getLlmCredentials: async () => fake.credentials,
}));
const indexPending = vi.hoisted(() => vi.fn(async () => 0));
vi.mock("../kb/indexer", () => ({ indexPending }));
vi.mock("../kb/service", () => ({ countPendingChunks: async () => fake.pending }));
const findRelated = vi.hoisted(() => vi.fn());
// Tipados con el contrato real del servicio de agenda: si no, el valor inicial fija «ok: true» y
// los casos de rechazo no compilan.
type Availability = Awaited<ReturnType<typeof import("../scheduling/service").availability>>;
type Booking = Awaited<ReturnType<typeof import("../scheduling/service").bookAppointment>>;
const agenda = vi.hoisted(() => ({
  ready: false,
  availability: vi.fn<(day: string) => Promise<Availability>>(async () => ({
    ok: true,
    slots: [{ startIso: "2026-09-17T10:00:00", endIso: "2026-09-17T10:30:00", label: "10:00" }],
  })),
  book: vi.fn<(input: { startIso: string; name: string; contact: string; motive: string }) => Promise<Booking>>(async () => ({
    ok: true,
    startIso: "2026-09-17T10:00:00",
    endIso: "2026-09-17T10:30:00",
    eventId: "e1",
  })),
}));
vi.mock("../scheduling/service", () => ({
  canSchedule: async () => agenda.ready,
  availability: (day: string) => agenda.availability(day),
  bookAppointment: (input: { startIso: string; name: string; contact: string; motive: string }) => agenda.book(input),
}));
vi.mock("./retrieve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./retrieve")>()),
  findRelated,
}));

const { MAX_MESSAGE, sendMessage } = await import("./service");

const found = [{ text: "[Horarios]\nAbrimos a las 7:00.", source: "Horarios", similarity: 0.82 }];

const send = (message: string, conversationId?: string) =>
  sendMessage({ conversationId, clientMessageId: randomUUID(), message });

const derivarCon = (motivo: string, mensaje = "Voy a consultar.", nota = "Preguntó por leche de almendras.") =>
  chat.mockResolvedValue({ tool: "derivar", args: JSON.stringify({ motivo, mensaje_al_cliente: mensaje, nota }) });

const ok = (result: Awaited<ReturnType<typeof sendMessage>>) => {
  if (!result.ok) throw new Error(`esperaba ok: ${result.error}`);
  return result;
};

beforeEach(async () => {
  await sql`delete from conversations`;
  fake.config = { companyName: "Café Aurora", prompt: "Eres el asistente.", model: "modelo-x", complete: true, missing: [] };
  fake.credentials = { provider, apiKey: "sk-guardada" };
  fake.pending = 0;
  chat.mockReset().mockResolvedValue({ text: "Abrimos a las 7:00." });
  agenda.ready = false;
  agenda.availability.mockClear();
  agenda.book.mockClear();
  findRelated.mockReset().mockResolvedValue(found);
  indexPending.mockClear();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("validaciones", () => {
  it.each(["", "   ", undefined, 42])("rechaza un mensaje vacío o que no es texto (%j)", async (message) => {
    expect(await sendMessage({ clientMessageId: randomUUID(), message })).toEqual({ ok: false, error: "Escribe un mensaje." });
    expect(chat).not.toHaveBeenCalled();
  });

  it(`rechaza un mensaje de más de ${MAX_MESSAGE} caracteres (FR-004)`, async () => {
    expect(await send("x".repeat(MAX_MESSAGE + 1))).toMatchObject({ ok: false });
    expect((await send("x".repeat(MAX_MESSAGE))).ok).toBe(true);
  });

  it("sin id de mensaje no guarda nada", async () => {
    expect(await sendMessage({ message: "hola" })).toMatchObject({ ok: false });
    expect(chat).not.toHaveBeenCalled();
  });

  it("con la configuración incompleta dice qué falta y no guarda ni llama a nadie (FR-011)", async () => {
    fake.config = { ...fake.config, complete: false, missing: ["la API key"] };
    fake.credentials = null;
    expect(await send("hola")).toEqual({ ok: false, error: expect.any(String), missing: ["la API key"] });
    expect(chat).not.toHaveBeenCalled();
    const [{ n }] = await sql`select count(*)::int as n from conversations`;
    expect(n).toBe(0);
  });
});

describe("respuesta normal (FR-001, FR-003)", () => {
  it("guarda el mensaje y la respuesta, y devuelve lo nuevo para el cliente", async () => {
    const result = ok(await send(" ¿A qué hora abren? "));

    expect(result.mode).toBe("ia");
    expect(result.entries.map((e) => ({ author: e.author, text: e.text }))).toEqual([
      { author: "bot", text: "Abrimos a las 7:00." },
    ]);
    expect(result.sources).toEqual(found);
    expect(await getEntries(result.conversationId, { forClient: true })).toHaveLength(2);
    expect(indexPending.mock.invocationCallOrder[0]).toBeLessThan(findRelated.mock.invocationCallOrder[0]);
  });

  it("ofrece la herramienta derivar al modelo", async () => {
    await send("hola");
    expect(chat.mock.calls[0][3]).toEqual([expect.objectContaining({ name: "derivar" })]);
  });

  it("el historial sale de la base, no del navegador, y sirve para seguir el tema", async () => {
    const first = ok(await send("¿A qué hora abren entre semana?"));
    await send("¿y los sábados?", first.conversationId);

    expect(findRelated.mock.calls[1][0]).toBe("¿A qué hora abren entre semana?\n¿y los sábados?");
    const [messages] = chat.mock.calls[1];
    expect(messages.slice(1, -1)).toEqual([
      { role: "user", content: "¿A qué hora abren entre semana?" },
      { role: "assistant", content: "Abrimos a las 7:00." },
    ]);
    expect(messages.at(-1)).toEqual({ role: "user", content: "¿y los sábados?" });
  });

  it("reintentar el mismo mensaje no llama otra vez al modelo", async () => {
    const clientMessageId = randomUUID();
    const first = await sendMessage({ clientMessageId, message: "hola" });
    const retry = ok(await sendMessage({ conversationId: ok(first).conversationId, clientMessageId, message: "hola" }));

    expect(chat).toHaveBeenCalledTimes(1);
    expect(retry.entries.map((e) => e.text)).toEqual(["Abrimos a las 7:00."]);
  });

  it("reintentar tras un fallo del proveedor responde sin guardar el mensaje dos veces (FR-012)", async () => {
    const clientMessageId = randomUUID();
    chat.mockRejectedValueOnce(new ProviderError("fake", "timeout"));
    const failed = await sendMessage({ clientMessageId, message: "¿a qué hora abren?" });
    expect(failed).toMatchObject({ ok: false });
    if (failed.ok) throw new Error("debía fallar");

    const retry = ok(await sendMessage({ conversationId: failed.conversationId, clientMessageId, message: "¿a qué hora abren?" }));
    expect(retry.entries.map((e) => e.text)).toEqual(["Abrimos a las 7:00."]);
    const all = await getEntries(retry.conversationId, { forClient: true });
    expect(all?.map((e) => e.author)).toEqual(["cliente", "bot"]);
  });

  it("avisa si queda información pendiente que el bot no pudo usar", async () => {
    fake.pending = 3;
    expect(await send("hola")).toMatchObject({ ok: true, pendingInfo: true });
  });
});

describe("derivación (FR-007…FR-012)", () => {
  it.each(["no_sabe", "enojo"] as const)("con motivo %s pasa a modo humano, con mensaje, nota y evento", async (motivo) => {
    derivarCon(motivo, "Voy a consultar.", "Preguntó por leche de almendras.");
    const result = ok(await send("¿tienen leche de almendras?"));

    expect(result.mode).toBe("humano");
    expect(result.entries.map((e) => e.text)).toEqual(["Voy a consultar."]);
    expect(await getConversation(result.conversationId)).toMatchObject({ mode: "humano", derived: true });
    const all = await getEntries(result.conversationId, { forClient: false });
    expect(all?.map((e) => e.author)).toEqual(["cliente", "bot", "nota", "evento"]);
    expect(all?.[2].text).toBe("Preguntó por leche de almendras.");
  });

  it("el primer pedido de persona no deriva: el bot ofrece ayudar; el segundo sí (FR-009)", async () => {
    derivarCon("pide_persona", "Te paso con alguien.", "Pidió hablar con una persona.");
    const first = ok(await send("quiero hablar con una persona"));
    expect(first.mode).toBe("ia");
    expect(first.entries[0].text).toMatch(/Con gusto te ayudo yo/);
    expect(await getConversation(first.conversationId)).toMatchObject({ derived: false, personRequests: 1 });

    const second = ok(await send("no, quiero una persona", first.conversationId));
    expect(second.mode).toBe("humano");
    expect(second.entries.map((e) => e.text)).toEqual(["Te paso con alguien."]);
  });

  it("si el modelo dice que va a consultar sin usar la herramienta y no encontró nada, deriva igual (respaldo)", async () => {
    findRelated.mockResolvedValue([]);
    chat.mockResolvedValue({ text: "No tengo esa información, voy a consultar." });
    const result = ok(await send("¿tienen wifi?"));

    expect(result.mode).toBe("humano");
    const all = await getEntries(result.conversationId, { forClient: false });
    expect(all?.map((e) => e.author)).toEqual(["cliente", "bot", "nota", "evento"]);
    expect(all?.[2].text).toMatch(/sin usar la herramienta/);
  });

  it("con información encontrada, decir «voy a consultar» no dispara el respaldo", async () => {
    chat.mockResolvedValue({ text: "Voy a consultar ese detalle con el barista y te cuento." });
    const result = ok(await send("¿el café es de Nariño?"));
    expect(result.mode).toBe("ia");
  });

  it("argumentos que no se pueden leer se tratan como fallo del proveedor", async () => {
    chat.mockResolvedValue({ tool: "derivar", args: "{ esto no es json" });
    expect(await send("hola")).toMatchObject({ ok: false, error: expect.stringMatching(/No pudimos contactar a Fake/) });

    chat.mockResolvedValue({ tool: "derivar", args: JSON.stringify({ motivo: "porque sí" }) });
    expect(await send("hola")).toMatchObject({ ok: false });
  });

  it("sin mensaje ni nota usa textos por defecto", async () => {
    chat.mockResolvedValue({ tool: "derivar", args: JSON.stringify({ motivo: "enojo", mensaje_al_cliente: "", nota: "  " }) });
    const result = ok(await send("esto es un desastre"));
    const all = await getEntries(result.conversationId, { forClient: false });
    expect(all?.[1].text).toMatch(/una persona del equipo/);
    expect(all?.[2].text).toMatch(/cliente enojado/);
  });
});

describe("modo humano (FR-015)", () => {
  it("no llama al modelo y devuelve lo que escribió el equipo", async () => {
    const first = ok(await send("hola"));
    await setMode(first.conversationId, "humano");
    await saveTeamReply(first.conversationId, "Hola, soy Ana del equipo.");
    chat.mockClear();

    const result = ok(await send("¿me ayudas?", first.conversationId));
    expect(chat).not.toHaveBeenCalled();
    expect(result.mode).toBe("humano");
    expect(result.entries).toEqual([]);
  });

  it("si el equipo toma la conversación mientras el modelo responde, la respuesta se descarta", async () => {
    const first = ok(await send("hola"));
    chat.mockImplementation(async () => {
      await setMode(first.conversationId, "humano");
      return { text: "respuesta tardía" };
    });

    const result = ok(await send("¿y los sábados?", first.conversationId));
    expect(result.mode).toBe("humano");
    expect(result.entries).toEqual([]);
    const texts = (await getEntries(first.conversationId, { forClient: true }))?.map((e) => e.text);
    expect(texts).not.toContain("respuesta tardía");
  });
});

describe("errores del proveedor (FR-012)", () => {
  it.each([
    ["invalid_key", /rechazó la API key/],
    ["no_credit", /no tiene saldo/],
    ["model_unavailable", /modelo-x ya no está disponible/],
    ["timeout", /tardó demasiado/],
    ["unavailable", /No pudimos contactar a Fake/],
  ] as const)("%s → mensaje claro, sin derivar y conservando la conversación", async (kind, text) => {
    chat.mockRejectedValue(new ProviderError("fake", kind));
    const result = await send("hola");
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(text), conversationId: expect.any(String) });
    if (result.ok) throw new Error("no debía responder");
    expect(await getConversation(result.conversationId!)).toMatchObject({ mode: "ia", derived: false });
  });

  it("un fallo al buscar también se traduce y nombra el modelo de búsqueda", async () => {
    findRelated.mockRejectedValue(new ProviderError("fake", "model_unavailable"));
    expect(await send("hola")).toMatchObject({ ok: false, error: expect.stringMatching(/text-embedding-3-small/) });
    expect(chat).not.toHaveBeenCalled();
  });

  it("un error que no es del proveedor no se esconde", async () => {
    chat.mockRejectedValue(new Error("bug"));
    await expect(send("hola")).rejects.toThrow("bug");
  });
});

describe("agendamiento (006)", () => {
  const cita = (args: Record<string, string>) =>
    chat.mockResolvedValueOnce({ tool: "agendar_cita", args: JSON.stringify(args) });

  it("sin cuenta conectada no ofrece las herramientas de agenda", async () => {
    await send("¿me pueden dar una cita?");
    const tools = chat.mock.calls[0][3]?.map((t) => t.name);
    expect(tools).toEqual(["derivar"]);
  });

  it("con agendamiento listo ofrece ver_disponibilidad y agendar_cita", async () => {
    agenda.ready = true;
    await send("¿me pueden dar una cita?");
    const tools = chat.mock.calls[0][3]?.map((t) => t.name);
    expect(tools).toEqual(["derivar", "ver_disponibilidad", "agendar_cita"]);
  });

  it("consulta la disponibilidad y se la devuelve al modelo para que responda", async () => {
    agenda.ready = true;
    chat.mockResolvedValueOnce({ tool: "ver_disponibilidad", args: JSON.stringify({ fecha: "2026-09-17" }) });
    chat.mockResolvedValueOnce({ text: "Tengo libre a las 10:00." });

    const result = ok(await send("¿qué horarios tienen el jueves?"));
    expect(agenda.availability).toHaveBeenCalledWith("2026-09-17");
    expect(result.entries.map((e) => e.text)).toEqual(["Tengo libre a las 10:00."]);
    // La segunda llamada al modelo lleva los horarios encontrados.
    expect(JSON.stringify(chat.mock.calls[1][0])).toContain("10:00");
  });

  it("agenda la cita y confirma la hora exacta", async () => {
    agenda.ready = true;
    cita({ fecha_hora: "2026-09-17T10:00:00", nombre: "Ana", contacto: "3001234567", motivo: "Pedido" });

    const result = ok(await send("Sí, confirmo la cita"));
    expect(agenda.book).toHaveBeenCalledWith(
      expect.objectContaining({ startIso: "2026-09-17T10:00:00", name: "Ana", contact: "3001234567" }),
    );
    expect(result.entries[0].text).toContain("10:00");
  });

  it("si el hueco ya está ocupado, lo dice y no confirma una cita falsa", async () => {
    agenda.ready = true;
    agenda.book.mockResolvedValueOnce({ ok: false, reason: "ocupado" });
    cita({ fecha_hora: "2026-09-17T10:00:00", nombre: "Ana", contacto: "300", motivo: "x" });

    const result = ok(await send("confirmo"));
    expect(result.entries[0].text).toMatch(/ocup/i);
    expect(result.mode).toBe("ia");
  });

  it("si Google falla, no inventa la cita y deriva a una persona (FR-010)", async () => {
    agenda.ready = true;
    agenda.book.mockResolvedValueOnce({ ok: false, reason: "google" });
    cita({ fecha_hora: "2026-09-17T10:00:00", nombre: "Ana", contacto: "300", motivo: "x" });

    const result = ok(await send("confirmo"));
    expect(result.mode).toBe("humano");
    const all = await getEntries(result.conversationId, { forClient: false });
    expect(all?.map((e) => e.author)).toContain("nota");
  });
});

describe("adjuntos (010)", () => {
  const foto = {
    name: "recibo.png",
    category: "imagen" as const,
    contentType: "image/png",
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  };

  const conArchivo = (message = "") => sendMessage({ clientMessageId: randomUUID(), message, attachment: foto });

  it("deriva a una persona sin llamar al proveedor, así que no gasta saldo (FR-009, FR-015)", async () => {
    const result = ok(await conArchivo("mira esto"));

    expect(result.mode).toBe("humano");
    expect(chat).not.toHaveBeenCalled();
    expect(findRelated).not.toHaveBeenCalled();
  });

  it("avisa al cliente y deja la nota con el motivo, solo para el equipo (FR-010)", async () => {
    const result = ok(await conArchivo("mira esto"));

    const all = await getEntries(result.conversationId, { forClient: false });
    expect(all?.map((e) => e.author)).toEqual(["cliente", "bot", "nota", "evento"]);
    expect(all?.find((e) => e.author === "nota")?.text).toContain("recibo.png");
    // El cliente ve el aviso, nunca la nota.
    expect(result.entries.map((e) => e.author)).toEqual(["bot"]);

    const [row] = await sql`select handoff_reason from conversations where id = ${result.conversationId}`;
    expect(row.handoff_reason).toBe("adjunto");
  });

  it("un mensaje solo con archivo, sin texto, es válido (FR-001)", async () => {
    expect(ok(await conArchivo("")).mode).toBe("humano");
  });

  it("sin texto y sin archivo no hay nada que enviar", async () => {
    expect(await sendMessage({ clientMessageId: randomUUID(), message: "" })).toEqual({
      ok: false,
      error: "Escribe un mensaje.",
    });
  });

  it("deriva aunque el archivo venga con una pregunta que sabría responder (HU-3)", async () => {
    const result = ok(await conArchivo("¿a qué hora abren?"));

    expect(result.mode).toBe("humano");
    expect(chat).not.toHaveBeenCalled();
  });

  it("el historial nombra el archivo en vez de mandarle al modelo un mensaje vacío", async () => {
    const first = ok(await conArchivo(""));
    await setMode(first.conversationId, "ia");
    await send("¿y ahora?", first.conversationId);

    expect(chat).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(chat.mock.calls[0][0])).toContain("recibo.png");
  });
});
