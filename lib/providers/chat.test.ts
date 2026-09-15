import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import openai401 from "./fixtures/openai-chat-401.json";
import openrouter401 from "./fixtures/openrouter-chat-401.json";
import { getProvider, ProviderError, type ChatMessage, type Tool } from "./index";

// Los 401 son respuestas reales grabadas el 2026-09-15 con una key falsa. Los demás cuerpos siguen la forma
// documentada por cada proveedor (no se pueden provocar sin una cuenta sin saldo o una key real).
const messages: ChatMessage[] = [
  { role: "system", content: "Eres el asistente de Café Aurora." },
  { role: "user", content: "¿A qué hora abren?" },
];
const completion = (content: unknown) => ({ id: "x", choices: [{ index: 0, message: { role: "assistant", content } }] });

const derivar: Tool = {
  name: "derivar",
  description: "Pasa la conversación a una persona del equipo.",
  parameters: { type: "object", properties: { motivo: { type: "string" } }, required: ["motivo"], additionalProperties: false },
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const respond = (status: number, body: unknown) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }));

async function kind(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderError);
  return (error as ProviderError).kind;
}

describe.each([
  ["openai", "https://api.openai.com/v1/chat/completions", openai401],
  ["openrouter", "https://openrouter.ai/api/v1/chat/completions", openrouter401],
])("chat de %s", (id, url, real401) => {
  const provider = getProvider(id)!;

  it("envía el modelo, los mensajes y temperatura baja con la key, y devuelve el texto", async () => {
    respond(200, completion("  Abrimos a las 7:00.  "));
    expect(await provider.chat(messages, "modelo-x", "sk-x")).toEqual({ text: "Abrimos a las 7:00." });

    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer sk-x", "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ model: "modelo-x", messages, temperature: 0.2 });
  });

  it("ofrece la herramienta al modelo y devuelve lo que pidió usar (004)", async () => {
    const args = '{"motivo":"no_sabe","mensaje_al_cliente":"Voy a consultar.","nota":"Preguntó por leche de almendras."}';
    respond(200, { id: "x", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "derivar", arguments: args } }] } }] });

    expect(await provider.chat(messages, "m", "sk-x", [derivar])).toEqual({ tool: "derivar", args });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      tools: [{ type: "function", function: { name: "derivar", description: derivar.description, parameters: derivar.parameters, strict: true } }],
      tool_choice: "auto",
    });
  });

  it("si el modelo responde texto teniendo la herramienta, devuelve el texto", async () => {
    respond(200, completion("Abrimos a las 7:00."));
    expect(await provider.chat(messages, "m", "sk-x", [derivar])).toEqual({ text: "Abrimos a las 7:00." });
  });

  it("con texto y herramienta a la vez, manda la herramienta", async () => {
    respond(200, { choices: [{ message: { content: "ya consulto", tool_calls: [{ function: { name: "derivar", arguments: "{}" } }] } }] });
    expect(await provider.chat(messages, "m", "sk-x", [derivar])).toEqual({ tool: "derivar", args: "{}" });
  });

  it("key inválida (401 real) → invalid_key", async () => {
    respond(401, real401);
    expect(await kind(provider.chat(messages, "m", "sk-x"))).toBe("invalid_key");
  });

  it.each([
    ["402 sin crédito (OpenRouter)", 402, { error: { code: 402, message: "Insufficient credits" } }, "no_credit"],
    ["429 credit_balance_exhausted (OpenAI)", 429, { error: { code: "credit_balance_exhausted", message: "x" } }, "no_credit"],
    ["429 insufficient_quota (OpenAI, código anterior)", 429, { error: { code: "insufficient_quota", message: "x" } }, "no_credit"],
    ["429 por límite de uso", 429, { error: { code: "rate_limit_exceeded", message: "x" } }, "unavailable"],
    ["404 modelo inexistente", 404, { error: { code: 404, message: "No such model" } }, "model_unavailable"],
    ["408 tiempo agotado", 408, { error: { code: 408, message: "timeout" } }, "timeout"],
    ["502 proveedor caído", 502, { error: { code: 502, message: "down" } }, "unavailable"],
    ["200 sin texto", 200, completion(""), "unavailable"],
    ["200 sin choices", 200, { id: "x" }, "unavailable"],
    ["200 con herramienta sin argumentos", 200, { choices: [{ message: { content: null, tool_calls: [{ function: { name: "derivar" } }] } }] }, "unavailable"],
  ])("%s → %s", async (_, status, body, expected) => {
    respond(status as number, body);
    expect(await kind(provider.chat(messages, "m", "sk-x"))).toBe(expected);
  });

  it("sin respuesta dentro del plazo → timeout", async () => {
    fetchMock.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    expect(await kind(provider.chat(messages, "m", "sk-x"))).toBe("timeout");
  });

  it("espera hasta 60 s, más que las demás llamadas", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    respond(200, completion("ok"));
    await provider.chat(messages, "m", "sk-x");
    expect(timeout).toHaveBeenCalledWith(60_000);
  });
});
