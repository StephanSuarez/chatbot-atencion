export type ProviderErrorKind = "invalid_key" | "unavailable";

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: ProviderErrorKind,
  ) {
    super(`${provider}: ${kind}`);
  }
}

const TIMEOUT_MS = 10_000;

export async function getJson(provider: string, url: string, apiKey?: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
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

// La respuesta del proveedor no es confiable (principio 3): se exige { data: [{ id: string, ... }] }.
export function modelsFrom(provider: string, body: unknown): Record<string, unknown>[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw fail(provider, "unavailable");
  return data.filter((m) => typeof m?.id === "string");
}

// Solo se registra el proveedor y el tipo de error, nunca la key (plan §7).
function fail(provider: string, kind: ProviderErrorKind): ProviderError {
  console.error(`[llm] ${provider}: ${kind}`);
  return new ProviderError(provider, kind);
}
