// Unidad: el grafo del turno con MemorySaver y dobles de los servicios, sin base de datos.
import { MemorySaver } from "@langchain/langgraph";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_MODEL, ProviderError, type ChatMessage, type ChatResult, type Provider, type Tool } from "../providers";
import type { Entry } from "../conversations/service";

const chat = vi.fn<(messages: ChatMessage[], model: string, key: string, tools?: Tool[]) => Promise<ChatResult>>();
const provider: Provider = { id: "fake", name: "Fake", chat, verifyKey: async () => {}, listChatModels: async () => [], embed: async () => [] };
const findRelated = vi.hoisted(() => vi.fn());
const saveBotTurn = vi.hoisted(() => vi.fn(async () => true));
const indexPending = vi.hoisted(() => vi.fn(async () => 0));
const history = vi.hoisted(() => ({ entries: [] as Entry[] }));
type Availability = Awaited<ReturnType<typeof import("../scheduling/service").availability>>;
type Booking = Awaited<ReturnType<typeof import("../scheduling/service").bookAppointment>>;
const agenda = vi.hoisted(() => ({
  ready: false,
  availability: vi.fn<(day: string) => Promise<Availability>>(async () => ({
    ok: true,
    slots: [{ startIso: "2026-09-17T10:00:00", endIso: "2026-09-17T10:30:00", label: "10:00" }],
  })),
  book: vi.fn<(input: { startIso: string }) => Promise<Booking>>(async () => ({
    ok: true,
    startIso: "2026-09-17T10:00:00",
    endIso: "2026-09-17T10:30:00",
    eventId: "e1",
  })),
}));

vi.mock("../config-service", () => ({ FIXED_RULES: ["No inventa respuestas."] }));
vi.mock("../kb/indexer", () => ({ indexPending }));
vi.mock("../kb/service", () => ({ countPendingChunks: async () => 0 }));
vi.mock("../conversations/service", () => ({ getEntries: async () => history.entries, saveBotTurn }));
vi.mock("../scheduling/service", () => ({
  canSchedule: async () => agenda.ready,
  availability: (day: string) => agenda.availability(day),
  bookAppointment: (input: { startIso: string }) => agenda.book(input),
}));
vi.mock("../chat/retrieve", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chat/retrieve")>()),
  findRelated,
}));

const { buildTurnGraph } = await import("./turno");

const found = [{ text: "[Horarios]\nAbrimos a las 7:00.", source: "Horarios", similarity: 0.82 }];
const input = {
  conversationId: "conv-1",
  seq: 5,
  message: "¿A qué hora abren?",
  companyName: "Café Aurora",
  prompt: "Eres el asistente.",
  model: "modelo-x",
  personRequests: 0,
};
const API_KEY = "sk-secreta-123";
const config = (threadId = "msg-1") => ({ configurable: { thread_id: threadId }, context: { provider, apiKey: API_KEY } });

let saver: MemorySaver;
let graph: ReturnType<typeof buildTurnGraph>;

/** Ejecuta el turno y devuelve los nodos por los que pasó, en orden. */
async function run(state: typeof input | null = input, cfg = config()) {
  const nodes: string[] = [];
  for await (const update of await graph.stream(state, { ...cfg, streamMode: "updates" })) nodes.push(Object.keys(update)[0]);
  return nodes;
}

const savedTurn = () => saveBotTurn.mock.calls[0] as unknown as [string, { entries: { author: string; text: string }[]; toHuman?: boolean; handoffReason?: string; personRequests?: number }];

const derivarCon = (motivo: string) =>
  chat.mockResolvedValue({ tool: "derivar", args: JSON.stringify({ motivo, mensaje_al_cliente: "Voy a consultar.", nota: "Faltó info." }) });

beforeEach(() => {
  saver = new MemorySaver();
  graph = buildTurnGraph(saver);
  chat.mockReset().mockResolvedValue({ text: "Abrimos a las 7:00." });
  findRelated.mockReset().mockResolvedValue(found);
  saveBotTurn.mockClear();
  indexPending.mockClear();
  agenda.ready = false;
  agenda.availability.mockClear();
  agenda.book.mockClear();
  history.entries = [];
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("camino normal", () => {
  it("recorre preparar → buscar → modelo → responder → guardar y guarda la respuesta del bot", async () => {
    expect(await run()).toEqual(["preparar", "buscar", "modelo", "responder", "guardar"]);
    const [conversationId, turn] = savedTurn();
    expect(conversationId).toBe("conv-1");
    expect(turn).toEqual({ entries: [{ author: "bot", text: "Abrimos a las 7:00." }] });
    expect(indexPending.mock.invocationCallOrder[0]).toBeLessThan(findRelated.mock.invocationCallOrder[0]);
  });

  it("arma el prompt con la empresa, la información encontrada y el historial anterior al mensaje", async () => {
    history.entries = [
      { seq: 1, author: "cliente", text: "hola", createdAt: new Date() },
      { seq: 2, author: "bot", text: "¡Hola!", createdAt: new Date() },
      { seq: 5, author: "cliente", text: "¿A qué hora abren?", createdAt: new Date() },
    ];
    await run();
    const [messages, model, key, tools] = chat.mock.calls[0];
    expect(messages[0].content).toContain("Café Aurora");
    expect(messages[0].content).toContain("Abrimos a las 7:00.");
    expect(messages.slice(1)).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "¡Hola!" },
      { role: "user", content: "¿A qué hora abren?" },
    ]);
    expect(model).toBe("modelo-x");
    expect(key).toBe(API_KEY);
    expect(tools?.map((t) => t.name)).toEqual(["derivar"]);
    expect(findRelated.mock.calls[0][0]).toBe("hola\n¿A qué hora abren?");
  });

  it("deja el estado del turno legible al terminar", async () => {
    await run();
    const { values } = await graph.getState(config());
    expect(values.sources).toEqual(found);
    expect(values.result).toEqual({ text: "Abrimos a las 7:00." });
    expect(values.turn?.entries[0].text).toBe("Abrimos a las 7:00.");
  });
});

describe("derivación", () => {
  it.each(["no_sabe", "enojo"] as const)("con motivo %s deriva con mensaje, nota y evento", async (motivo) => {
    derivarCon(motivo);
    await run();
    const [, turn] = savedTurn();
    expect(turn.toHuman).toBe(true);
    expect(turn.handoffReason).toBe(motivo);
    expect(turn.entries.map((e) => e.author)).toEqual(["bot", "nota", "evento"]);
  });

  it("el primer pedido de persona no deriva y anota el pedido; con uno previo, deriva", async () => {
    derivarCon("pide_persona");
    await run();
    expect(savedTurn()[1]).toMatchObject({ personRequests: 1, entries: [{ author: "bot", text: expect.stringMatching(/Con gusto te ayudo yo/) }] });

    saveBotTurn.mockClear();
    await run({ ...input, personRequests: 1 }, config("msg-2"));
    expect(savedTurn()[1]).toMatchObject({ toHuman: true, handoffReason: "pide_persona" });
  });

  it("sin información y con un texto de «voy a consultar», deriva por respaldo", async () => {
    findRelated.mockResolvedValue([]);
    chat.mockResolvedValue({ text: "No tengo esa información, voy a consultar." });
    await run();
    const [, turn] = savedTurn();
    expect(turn).toMatchObject({ toHuman: true, handoffReason: "no_sabe" });
    expect(turn.entries[1].text).toMatch(/sin usar la herramienta/);
  });

  it("argumentos ilegibles de derivar son un fallo del proveedor y no se guarda nada", async () => {
    chat.mockResolvedValue({ tool: "derivar", args: "{ esto no es json" });
    await expect(run()).rejects.toMatchObject({ provider: "fake", kind: "unavailable" });
    expect(saveBotTurn).not.toHaveBeenCalled();
  });
});

describe("agendamiento", () => {
  const cita = (args: Record<string, string>) => chat.mockResolvedValueOnce({ tool: "agendar_cita", args: JSON.stringify(args) });

  it("con agenda lista ofrece las tres herramientas", async () => {
    agenda.ready = true;
    await run();
    expect(chat.mock.calls[0][3]?.map((t) => t.name)).toEqual(["derivar", "ver_disponibilidad", "agendar_cita"]);
  });

  it("consulta la disponibilidad y vuelve al modelo con los horarios", async () => {
    agenda.ready = true;
    chat.mockResolvedValueOnce({ tool: "ver_disponibilidad", args: JSON.stringify({ fecha: "2026-09-17" }) });
    chat.mockResolvedValueOnce({ text: "Tengo libre a las 10:00." });

    expect(await run()).toEqual(["preparar", "buscar", "modelo", "disponibilidad", "modelo", "responder", "guardar"]);
    expect(agenda.availability).toHaveBeenCalledWith("2026-09-17");
    expect(chat.mock.calls[1][0].at(-1)).toEqual({ role: "system", content: expect.stringContaining("10:00") });
    expect(savedTurn()[1].entries[0].text).toBe("Tengo libre a las 10:00.");
  });

  it("una segunda consulta de disponibilidad en el mismo turno se trata como respuesta inválida (como antes)", async () => {
    agenda.ready = true;
    chat.mockResolvedValue({ tool: "ver_disponibilidad", args: JSON.stringify({ fecha: "2026-09-17" }) });
    await expect(run()).rejects.toMatchObject({ kind: "unavailable" });
    expect(agenda.availability).toHaveBeenCalledTimes(1);
  });

  it("agenda y confirma la hora exacta", async () => {
    agenda.ready = true;
    cita({ fecha_hora: "2026-09-17T10:00:00", nombre: "Ana", contacto: "300", motivo: "Pedido" });
    expect(await run()).toEqual(["preparar", "buscar", "modelo", "agendar", "guardar"]);
    expect(savedTurn()[1].entries[0].text).toContain("10:00");
  });

  it("un hueco ocupado se rechaza sin derivar; un fallo de Google deriva sin motivo del modelo", async () => {
    agenda.ready = true;
    agenda.book.mockResolvedValueOnce({ ok: false, reason: "ocupado" });
    cita({ fecha_hora: "2026-09-17T10:00:00", nombre: "Ana", contacto: "300", motivo: "x" });
    await run();
    expect(savedTurn()[1]).toEqual({ entries: [{ author: "bot", text: expect.stringMatching(/ocup/i) }] });

    saveBotTurn.mockClear();
    agenda.book.mockResolvedValueOnce({ ok: false, reason: "google" });
    cita({ fecha_hora: "2026-09-17T10:00:00", nombre: "Ana", contacto: "300", motivo: "x" });
    await run(input, config("msg-2"));
    const [, turn] = savedTurn();
    expect(turn.toHuman).toBe(true);
    expect(turn.handoffReason).toBeUndefined();
    expect(turn.entries.map((e) => e.author)).toEqual(["bot", "nota", "evento"]);
  });
});

describe("fallos del proveedor", () => {
  it("un fallo al buscar nombra el modelo de búsqueda; uno al responder, el modelo de chat", async () => {
    findRelated.mockRejectedValueOnce(new ProviderError("fake", "model_unavailable"));
    await expect(run()).rejects.toMatchObject({ kind: "model_unavailable", model: EMBEDDING_MODEL });

    chat.mockRejectedValueOnce(new ProviderError("fake", "timeout"));
    await expect(run(input, config("msg-2"))).rejects.toMatchObject({ kind: "timeout", model: "modelo-x" });
  });

  it("un error que no es del proveedor sale tal cual", async () => {
    chat.mockRejectedValueOnce(new Error("bug"));
    await expect(run()).rejects.toThrow("bug");
  });
});

describe("checkpoints", () => {
  it("un turno interrumpido en el modelo se reanuda sin volver a buscar (SC-004)", async () => {
    chat.mockRejectedValueOnce(new ProviderError("fake", "timeout"));
    await expect(run()).rejects.toMatchObject({ kind: "timeout" });
    expect((await graph.getState(config())).next).toEqual(["modelo"]);

    expect(await run(null)).toEqual(["modelo", "responder", "guardar"]);
    expect(findRelated).toHaveBeenCalledTimes(1);
    expect(saveBotTurn).toHaveBeenCalledTimes(1);
    expect(savedTurn()[1].entries[0].text).toBe("Abrimos a las 7:00.");
  });

  it("ningún checkpoint contiene la API key (SC-005)", async () => {
    await run();
    let count = 0;
    for await (const tuple of saver.list(config())) {
      count++;
      expect(JSON.stringify(tuple)).not.toContain(API_KEY);
    }
    expect(count).toBeGreaterThan(0);
  });
});
