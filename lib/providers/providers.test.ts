import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProvider, ProviderError, providers } from "./index";
// Respuestas reales grabadas el 2026-09-14 con keys falsas (401) y la lista pública de OpenRouter (recortada).
import openai401 from "./fixtures/openai-401.json";
import openrouterKey401 from "./fixtures/openrouter-key-401.json";
import openrouterModels from "./fixtures/openrouter-models.json";

const openai = getProvider("openai")!;
const openrouter = getProvider("openrouter")!;
const apiKey = "sk-secreta-de-prueba";

let fetchMock: ReturnType<typeof vi.fn>;
let logs: string[];

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  logs = [];
  vi.spyOn(console, "error").mockImplementation((...args) => void logs.push(args.join(" ")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Una Response nueva por llamada: el cuerpo de una Response solo se puede leer una vez.
const respond = (status: number, body: unknown) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }));

async function errorKind(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderError);
  return (error as ProviderError).kind;
}

describe("registro", () => {
  it("tiene OpenAI y OpenRouter", () => {
    expect(providers.map((p) => p.id)).toEqual(["openai", "openrouter"]);
    expect(getProvider("otro")).toBeUndefined();
  });

  it("los métodos funcionan aunque se usen sueltos", async () => {
    respond(200, { data: [] });
    const { verifyKey, listChatModels } = openai;
    await verifyKey(apiKey);
    expect(await listChatModels(apiKey)).toEqual([]);
  });
});

describe("OpenAI", () => {
  it("verifica la key contra /v1/models con Bearer", async () => {
    respond(200, { object: "list", data: [] });
    await openai.verifyKey(apiKey);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect(init.headers).toEqual({ Authorization: `Bearer ${apiKey}` });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("key inválida (401 real) → invalid_key", async () => {
    respond(401, openai401);
    expect(await errorKind(openai.verifyKey(apiKey))).toBe("invalid_key");
  });

  it("lista solo modelos de chat, ordenados", async () => {
    // Construida con el formato de /v1/models (no grabada: requiere una key real).
    const ids = [
      "gpt-4o-mini", "text-embedding-3-small", "whisper-1", "tts-1", "dall-e-3", "omni-moderation-latest",
      "gpt-4o-realtime-preview", "gpt-4o-audio-preview", "gpt-4o-transcribe", "gpt-image-1", "sora-2",
      "babbage-002", "davinci-002", "o3-mini", "gpt-4o",
    ];
    respond(200, { object: "list", data: ids.map((id) => ({ id, object: "model", owned_by: "openai" })) });
    expect(await openai.listChatModels(apiKey)).toEqual(["gpt-4o", "gpt-4o-mini", "o3-mini"]);
  });
});

describe("OpenRouter", () => {
  it("verifica la key contra /api/v1/key con Bearer", async () => {
    respond(200, { data: { label: "x" } });
    await openrouter.verifyKey(apiKey);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/key");
    expect(init.headers).toEqual({ Authorization: `Bearer ${apiKey}` });
  });

  it("key inválida (401 real) → invalid_key", async () => {
    respond(401, openrouterKey401);
    expect(await errorKind(openrouter.verifyKey(apiKey))).toBe("invalid_key");
  });

  it("lista solo modelos que generan texto, ordenados", async () => {
    // El último modelo es construido: hoy ningún modelo real de OpenRouter deja de generar texto.
    const imageOnly = { id: "a/solo-imagen", architecture: { output_modalities: ["image"] } };
    respond(200, { data: [...openrouterModels.data, imageOnly] });

    const expected = openrouterModels.data.map((m) => m.id).sort();
    expect(await openrouter.listChatModels(apiKey)).toEqual(expected);
    expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/models");
  });
});

describe("errores del proveedor", () => {
  it.each([
    ["500", () => respond(500, { error: "boom" })],
    ["429", () => respond(429, { error: "rate limit" })],
    ["error de red", () => fetchMock.mockRejectedValue(new TypeError("fetch failed"))],
    ["timeout", () => fetchMock.mockRejectedValue(new DOMException("timeout", "TimeoutError"))],
    ["respuesta sin data", () => respond(200, { foo: 1 })],
    ["respuesta no JSON", () => fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }))],
  ])("%s → unavailable", async (_, setup) => {
    setup();
    expect(await errorKind(openai.listChatModels(apiKey))).toBe("unavailable");
  });

  it("el log tiene proveedor y tipo de error, nunca la key", async () => {
    respond(401, openai401);
    await openai.verifyKey(apiKey).catch(() => {});
    expect(logs).toEqual(["[llm] openai: invalid_key"]);
  });
});
