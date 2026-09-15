import { FIXED_RULES, getConfig, getLlmCredentials } from "../config-service";
import { indexPending } from "../kb/indexer";
import { countPendingChunks } from "../kb/service";
import { ProviderError, type ChatMessage, type ProviderErrorKind } from "../providers";
import { buildMessages, HISTORY_LIMIT } from "./prompt";
import { findRelated, retrievalQuery, type FoundChunk } from "./retrieve";

// Reglas de la spec 003 para responder un mensaje (plan §3). Nada de la conversación se guarda (FR-003).

export const MAX_MESSAGE = 1000;
// Una respuesta del bot puede ser más larga que un mensaje del cliente; el historial viene del navegador y no es confiable.
const MAX_HISTORY_CONTENT = 4000;

export type SendResult =
  | { ok: true; reply: string; sources: FoundChunk[]; pendingInfo: boolean }
  | { ok: false; error: string; missing?: string[] };

export async function sendMessage(input: { history?: unknown; message?: unknown }): Promise<SendResult> {
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) return { ok: false, error: "Escribe un mensaje." };
  if (message.length > MAX_MESSAGE) return { ok: false, error: `El mensaje supera los ${MAX_MESSAGE} caracteres.` };

  const config = await getConfig();
  const credentials = await getLlmCredentials();
  if (!config.complete || !credentials || !config.model) {
    return { ok: false, error: "Tu chatbot todavía no está listo para conversar.", missing: config.missing };
  }

  const history = cleanHistory(input.history);
  const { provider, apiKey } = credentials;
  const started = Date.now();
  try {
    // Red de seguridad del plan 002: lo que quedó pendiente se indexa antes de buscar.
    await indexPending();
    const pendingInfo = (await countPendingChunks()) > 0;
    const sources = await findRelated(retrievalQuery(history, message), provider, apiKey);
    const messages = buildMessages({
      companyName: config.companyName,
      prompt: config.prompt,
      fixedRules: FIXED_RULES,
      found: sources,
      history,
      message,
    });
    const reply = await provider.chat(messages, config.model, apiKey);
    console.info(
      `[chat] ${provider.id} ${config.model}: ${sources.length} pedazos, mejor ${sources[0]?.similarity.toFixed(2) ?? "-"}, ${Date.now() - started} ms`,
    );
    return { ok: true, reply, sources, pendingInfo };
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    return { ok: false, error: providerMessage(e.kind, provider.name, config.model) };
  }
}

function cleanHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (m): m is ChatMessage =>
        (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content.trim() !== "",
    )
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CONTENT) }));
}

const providerMessage = (kind: ProviderErrorKind, name: string, model: string) =>
  ({
    invalid_key: `${name} rechazó la API key. Revísala en Tu chatbot.`,
    no_credit: `Tu cuenta de ${name} no tiene saldo. Recárgala y vuelve a intentar.`,
    model_unavailable: `El modelo ${model} ya no está disponible en ${name}. Elige otro en Tu chatbot.`,
    timeout: `${name} tardó demasiado en responder. Intenta de nuevo.`,
    unavailable: `No pudimos contactar a ${name}. Intenta de nuevo en unos segundos.`,
  })[kind];
