import { FIXED_RULES, getConfig, getLlmCredentials } from "../config-service";
import {
  getConversation,
  getEntries,
  saveBotTurn,
  saveClientMessage,
  type Entry,
  type Mode,
} from "../conversations/service";
import { indexPending } from "../kb/indexer";
import { countPendingChunks } from "../kb/service";
import { EMBEDDING_MODEL, ProviderError, type ChatMessage, type ChatResult, type ProviderErrorKind } from "../providers";
import { DERIVAR, FIRST_PERSON_REQUEST, parseDerivation, REASON_LABEL, type Derivation } from "./derivar";
import { buildMessages, HISTORY_LIMIT } from "./prompt";
import { findRelated, retrievalQuery, type FoundChunk } from "./retrieve";

// Reglas de la spec 003 para responder un mensaje, más la derivación de la 004 (plan 004 §3, §4).

export const MAX_MESSAGE = 1000;
// Una respuesta del bot puede ser mucho más larga que un mensaje del cliente.
const MAX_HISTORY_CONTENT = 4000;

export type SendResult =
  | { ok: true; conversationId: string; entries: Entry[]; mode: Mode; sources: FoundChunk[]; pendingInfo: boolean }
  | { ok: false; error: string; missing?: string[]; conversationId?: string };

export async function sendMessage(input: {
  conversationId?: unknown;
  clientMessageId?: unknown;
  message?: unknown;
}): Promise<SendResult> {
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) return { ok: false, error: "Escribe un mensaje." };
  if (message.length > MAX_MESSAGE) return { ok: false, error: `El mensaje supera los ${MAX_MESSAGE} caracteres.` };
  const clientMessageId = typeof input.clientMessageId === "string" ? input.clientMessageId : "";
  if (!clientMessageId) return { ok: false, error: "No pudimos enviar el mensaje. Recarga la página." };

  const config = await getConfig();
  const credentials = await getLlmCredentials();
  if (!config.complete || !credentials || !config.model) {
    return { ok: false, error: "Tu chatbot todavía no está listo para conversar.", missing: config.missing };
  }

  const saved = await saveClientMessage({ conversationId: input.conversationId, clientMessageId, text: message });
  const { conversationId, seq } = saved;
  const conversation = await getConversation(conversationId);
  const since = (mode: Mode) => answer(conversationId, seq, mode);

  // En modo humano responde el equipo; un reintento ya guardado tampoco vuelve a llamar al modelo.
  if (!conversation || conversation.mode === "humano" || saved.duplicate) return since(conversation?.mode ?? "ia");

  const { provider, apiKey } = credentials;
  const started = Date.now();
  // El mismo tipo de error puede venir de buscar (modelo de embeddings) o de responder (modelo de chat).
  let failingModel = EMBEDDING_MODEL;
  try {
    // Red de seguridad del plan 002: lo que quedó pendiente se indexa antes de buscar.
    await indexPending();
    const pendingInfo = (await countPendingChunks()) > 0;
    const history = await recentHistory(conversationId, seq);
    const sources = await findRelated(retrievalQuery(history, message), provider, apiKey);
    const messages = buildMessages({
      companyName: config.companyName,
      prompt: config.prompt,
      fixedRules: FIXED_RULES,
      found: sources,
      history,
      message,
    });
    failingModel = config.model;
    const result = await provider.chat(messages, config.model, apiKey, [DERIVAR]);
    const derivation = derivationOf(result, sources.length, provider.id);

    if (derivation && !(derivation.reason === "pide_persona" && conversation.personRequests === 0)) {
      await saveBotTurn(conversationId, {
        entries: [
          { author: "bot", text: derivation.message },
          { author: "nota", text: derivation.note },
          { author: "evento", text: `El bot pasó la conversación a modo humano (${REASON_LABEL[derivation.reason]}).` },
        ],
        toHuman: true,
      });
    } else if (derivation) {
      // Primer pedido de persona: el bot ofrece ayudar él mismo y el servidor anota el pedido (FR-009).
      await saveBotTurn(conversationId, { entries: [{ author: "bot", text: FIRST_PERSON_REQUEST }], personRequests: 1 });
    } else {
      await saveBotTurn(conversationId, { entries: [{ author: "bot", text: (result as { text: string }).text }] });
    }

    console.info(
      `[chat] ${provider.id} ${config.model} conv=${conversationId}: ${sources.length} pedazos, mejor ${
        sources[0]?.similarity.toFixed(2) ?? "-"
      }, ${derivation ? `derivar=${derivation.reason}` : "respuesta"}, ${Date.now() - started} ms`,
    );
    const after = await answer(conversationId, seq, "ia", sources, pendingInfo);
    return after;
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    return { ok: false, error: providerMessage(e.kind, provider.name, failingModel), conversationId };
  }
}

/** Lo que el cliente todavía no tiene: su conversación puede haber cambiado de modo mientras tanto. */
async function answer(
  conversationId: string,
  seq: number,
  fallbackMode: Mode,
  sources: FoundChunk[] = [],
  pendingInfo = false,
): Promise<SendResult> {
  const [entries, conversation] = await Promise.all([
    getEntries(conversationId, { after: seq, forClient: true }),
    getConversation(conversationId),
  ]);
  return { ok: true, conversationId, entries: entries ?? [], mode: conversation?.mode ?? fallbackMode, sources, pendingInfo };
}

/**
 * Respaldo del plan §4: si no encontró información y el modelo respondió texto diciendo que va a consultar
 * en vez de usar la herramienta, se deriva igual.
 */
const SAYS_WILL_ASK = /voy a consultar|no tengo esa informaci[óo]n|consultar con (el equipo|una persona)/i;

function derivationOf(result: ChatResult, foundCount: number, providerId: string): Derivation | null {
  if ("tool" in result) {
    const derivation = parseDerivation(result.args);
    if (!derivation) throw new ProviderError(providerId, "unavailable");
    return derivation;
  }
  if (foundCount === 0 && SAYS_WILL_ASK.test(result.text)) {
    return {
      reason: "no_sabe",
      message: result.text,
      note: "El bot dijo que iba a consultar sin usar la herramienta.",
    };
  }
  return null;
}

const ROLE: Record<string, ChatMessage["role"]> = { cliente: "user", bot: "assistant", equipo: "assistant" };

async function recentHistory(conversationId: string, beforeSeq: number): Promise<ChatMessage[]> {
  const entries = (await getEntries(conversationId, { forClient: true })) ?? [];
  return entries
    .filter((entry) => entry.seq < beforeSeq)
    .slice(-HISTORY_LIMIT)
    .map((entry) => ({ role: ROLE[entry.author], content: entry.text.slice(0, MAX_HISTORY_CONTENT) }));
}

const providerMessage = (kind: ProviderErrorKind, name: string, model: string) =>
  ({
    invalid_key: `${name} rechazó la API key. Revísala en Tu chatbot.`,
    no_credit: `Tu cuenta de ${name} no tiene saldo. Recárgala y vuelve a intentar.`,
    model_unavailable: `El modelo ${model} ya no está disponible en ${name}. Elige otro en Tu chatbot.`,
    timeout: `${name} tardó demasiado en responder. Intenta de nuevo.`,
    unavailable: `No pudimos contactar a ${name}. Intenta de nuevo en unos segundos.`,
  })[kind];
