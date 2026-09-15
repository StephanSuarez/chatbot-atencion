import { EMBEDDING_DIMENSIONS } from "../schema";

export type ProviderErrorKind = "invalid_key" | "unavailable";

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: ProviderErrorKind,
  ) {
    super(`${provider}: ${kind}`);
  }
}

// Mismo modelo en ambos proveedores: cambiar de proveedor no obliga a reindexar (plan 002 §4).
export const EMBEDDING_MODEL = "text-embedding-3-small";

const TIMEOUT_MS = 10_000;

async function request(provider: string, url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw fail(provider, "unavailable");
  }
  if (res.status === 401) throw fail(provider, "invalid_key");
  if (!res.ok) throw fail(provider, "unavailable");
  try {
    return await res.json();
  } catch {
    throw fail(provider, "unavailable");
  }
}

const auth = (apiKey?: string): Record<string, string> => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {});

export function getJson(provider: string, url: string, apiKey?: string): Promise<unknown> {
  return request(provider, url, { headers: auth(apiKey) });
}

// La respuesta del proveedor no es confiable (principio 3): se exige { data: [{ id: string, ... }] }.
export function modelsFrom(provider: string, body: unknown): Record<string, unknown>[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw fail(provider, "unavailable");
  return data.filter((m) => typeof m?.id === "string");
}

// POST /embeddings compatible con OpenAI. Devuelve un vector por texto, en el mismo orden.
export async function embeddings(provider: string, url: string, model: string, texts: string[], apiKey: string) {
  const body = await request(provider, url, {
    method: "POST",
    headers: { ...auth(apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
  });
  const data = (body as { data?: unknown } | null)?.data;
  const byIndex = new Map(
    (Array.isArray(data) ? data : []).map((d: { index?: unknown; embedding?: unknown }) => [d?.index, d?.embedding]),
  );
  const vectors = texts.map((_, i) => byIndex.get(i));
  if (!vectors.every(isVector)) throw fail(provider, "unavailable");
  return vectors as number[][];
}

const isVector = (v: unknown) =>
  Array.isArray(v) && v.length === EMBEDDING_DIMENSIONS && v.every((n) => typeof n === "number" && Number.isFinite(n));

// Solo se registra el proveedor y el tipo de error, nunca la key (plan §7).
function fail(provider: string, kind: ProviderErrorKind): ProviderError {
  console.error(`[llm] ${provider}: ${kind}`);
  return new ProviderError(provider, kind);
}
