import { EMBEDDING_DIMENSIONS } from "../schema";

export type ProviderErrorKind = "invalid_key" | "no_credit" | "model_unavailable" | "timeout" | "unavailable";

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
// Los modelos que razonan tardan bastante más que listar modelos o calcular embeddings (plan 003 §6).
const CHAT_TIMEOUT_MS = 60_000;

async function request(provider: string, url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw fail(provider, (e as Error)?.name === "TimeoutError" ? "timeout" : "unavailable");
  }
  if (!res.ok) throw fail(provider, await errorKind(res));
  try {
    return await res.json();
  } catch {
    throw fail(provider, "unavailable");
  }
}

// Verificado en la documentación oficial el 2026-09-15: OpenRouter usa 402 (sin crédito), 404 (modelo inexistente)
// y 408 (tiempo agotado); OpenAI usa 429 con code credit_balance_exhausted. insufficient_quota es el código anterior
// de OpenAI. El 404 de OpenAI para un modelo inexistente no figura en su documentación.
async function errorKind(res: Response): Promise<ProviderErrorKind> {
  if (res.status === 401) return "invalid_key";
  if (res.status === 402) return "no_credit";
  if (res.status === 404) return "model_unavailable";
  if (res.status === 408) return "timeout";
  if (res.status === 429) {
    const code = await res.json().then(
      (body: { error?: { code?: unknown } } | null) => body?.error?.code,
      () => undefined,
    );
    if (code === "credit_balance_exhausted" || code === "insufficient_quota") return "no_credit";
  }
  return "unavailable";
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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// POST /chat/completions compatible con OpenAI. Temperatura baja: respuestas estables para no inventar (plan 003 §12).
export async function chatCompletion(provider: string, url: string, model: string, messages: ChatMessage[], apiKey: string) {
  const body = await request(
    provider,
    url,
    {
      method: "POST",
      headers: { ...auth(apiKey), "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.2 }),
    },
    CHAT_TIMEOUT_MS,
  );
  const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw fail(provider, "unavailable");
  return content.trim();
}

// Solo se registra el proveedor y el tipo de error, nunca la key (plan §7).
function fail(provider: string, kind: ProviderErrorKind): ProviderError {
  console.error(`[llm] ${provider}: ${kind}`);
  return new ProviderError(provider, kind);
}
