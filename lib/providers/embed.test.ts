import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "../schema";
import { getProvider, ProviderError } from "./index";

// Formato de /embeddings compatible con OpenAI (no grabado: requiere una key con saldo).
const vector = (seed: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? seed : 0));
const response = (vectors: number[][], order = vectors.map((_, i) => i)) => ({
  object: "list",
  data: order.map((index) => ({ object: "embedding", index, embedding: vectors[index] })),
  model: "text-embedding-3-small",
});

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

describe.each([
  ["openai", "https://api.openai.com/v1/embeddings", "text-embedding-3-small"],
  ["openrouter", "https://openrouter.ai/api/v1/embeddings", "openai/text-embedding-3-small"],
])("embed de %s", (id, url, model) => {
  const provider = getProvider(id)!;

  it("envía los textos al modelo de embeddings con la key", async () => {
    respond(200, response([vector(1), vector(2)]));
    await provider.embed(["a", "b"], "sk-x");

    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer sk-x", "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ model, input: ["a", "b"] });
  });

  it("devuelve un vector por texto en el orden de los textos, aunque lleguen desordenados", async () => {
    respond(200, response([vector(1), vector(2), vector(3)], [2, 0, 1]));
    const vectors = await provider.embed(["a", "b", "c"], "sk-x");
    expect(vectors.map((v) => v[0])).toEqual([1, 2, 3]);
  });

  it.each([
    ["faltan vectores", { data: [] }],
    ["dimensión distinta", { data: [{ index: 0, embedding: [1, 2, 3] }] }],
    ["valores no numéricos", { data: [{ index: 0, embedding: vector(1).map(String) }] }],
    ["sin data", { foo: 1 }],
  ])("respuesta inválida (%s) → unavailable", async (_, body) => {
    respond(200, body);
    const error = await provider.embed(["a"], "sk-x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe("unavailable");
  });

  it("key inválida → invalid_key", async () => {
    respond(401, { error: { message: "Invalid key" } });
    const error = await provider.embed(["a"], "sk-x").catch((e: unknown) => e);
    expect((error as ProviderError).kind).toBe("invalid_key");
  });
});
