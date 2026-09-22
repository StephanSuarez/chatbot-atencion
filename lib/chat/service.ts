import { getConfig, getLlmCredentials } from "../config-service";
import {
  getConversation,
  getEntries,
  saveBotTurn,
  saveClientMessage,
  type Entry,
  type Mode,
  type NewAttachment,
} from "../conversations/service";
import { DbSaver } from "../graph/checkpointer";
import { buildTurnGraph } from "../graph/turno";
import { ProviderError, type ProviderErrorKind } from "../providers";
import type { FoundChunk } from "./retrieve";

// Reglas de la spec 003 para recibir un mensaje, más la derivación de la 004 (plan 004 §3, §4). El turno del
// bot en sí corre como grafo con checkpoints (011): lo previo al turno se decide aquí.

export const MAX_MESSAGE = 1000;

const saver = new DbSaver();
const turnGraph = buildTurnGraph(saver);

export type SendResult =
  | { ok: true; conversationId: string; entries: Entry[]; mode: Mode; sources: FoundChunk[]; pendingInfo: boolean }
  | { ok: false; error: string; missing?: string[]; conversationId?: string };

export async function sendMessage(input: {
  conversationId?: unknown;
  clientMessageId?: unknown;
  message?: unknown;
  // Las simulaciones (009) crean sus conversaciones con su propio origen.
  origin?: "chat_de_prueba" | "simulacion";
  // Ya validado por `lib/attachments` antes de llegar aquí (010).
  attachment?: NewAttachment;
}): Promise<SendResult> {
  const message = typeof input.message === "string" ? input.message.trim() : "";
  // Un mensaje solo con archivo es válido (FR-001); sin texto y sin archivo no hay nada que enviar.
  if (!message && !input.attachment) return { ok: false, error: "Escribe un mensaje." };
  if (message.length > MAX_MESSAGE) return { ok: false, error: `El mensaje supera los ${MAX_MESSAGE} caracteres.` };
  const clientMessageId = typeof input.clientMessageId === "string" ? input.clientMessageId : "";
  if (!clientMessageId) return { ok: false, error: "No pudimos enviar el mensaje. Recarga la página." };

  const config = await getConfig();
  const credentials = await getLlmCredentials();
  if (!config.complete || !credentials || !config.model) {
    return { ok: false, error: "Tu chatbot todavía no está listo para conversar.", missing: config.missing };
  }

  const saved = await saveClientMessage({
    conversationId: input.conversationId,
    clientMessageId,
    text: message,
    origin: input.origin,
    attachment: input.attachment,
  });
  const { conversationId, seq } = saved;
  const conversation = await getConversation(conversationId);
  if (!conversation || conversation.mode === "humano") return answer(conversationId, seq, conversation?.mode ?? "ia");

  // Reintento del mismo mensaje: si ya tiene respuesta se devuelve esa; si el proveedor falló antes de
  // responder, no hay respuesta todavía y se vuelve a intentar sin guardar el mensaje otra vez (FR-012).
  if (saved.duplicate) {
    const previous = await answer(conversationId, seq, conversation.mode);
    if (!previous.ok || previous.entries.length > 0) return previous;
  }

  // El archivo no se le manda al modelo: el bot no puede leerlo, así que deriva por código y sin gastar
  // saldo (FR-009, FR-015). Deriva aunque el mensaje traiga además una pregunta que sabría responder:
  // contestar solo a la mitad de lo que mandó el cliente confunde más de lo que ayuda.
  // Sin condición sobre el reintento: si el primer intento ya derivó, la conversación está en modo
  // humano y se sale mucho antes. Llegar aquí significa que la derivación no ocurrió.
  if (input.attachment) {
    await saveBotTurn(conversationId, {
      entries: [
        { author: "bot", text: "Recibí tu archivo. Una persona del equipo lo va a revisar y te responde por aquí." },
        { author: "nota", text: `El cliente envió un archivo que el bot no puede leer: ${input.attachment.name}.` },
        { author: "evento", text: "El bot pasó la conversación a modo humano (recibió un archivo)." },
      ],
      toHuman: true,
      handoffReason: "adjunto",
    });
    console.info(`[chat] conv=${conversationId}: derivado por adjunto`);
    return answer(conversationId, seq, "humano");
  }

  const { provider, apiKey } = credentials;
  // Un hilo por mensaje del cliente: las credenciales van en el contexto, nunca en el estado (plan 011 §5).
  const thread = { configurable: { thread_id: clientMessageId }, context: { provider, apiKey } };
  try {
    // Si el turno de este mensaje quedó a medias, se reanuda desde el último nodo completado (FR-003).
    const pending = (await turnGraph.getState(thread)).next.length > 0;
    const state = await turnGraph.invoke(
      pending
        ? null
        : {
            conversationId,
            seq,
            message,
            companyName: config.companyName,
            prompt: config.prompt,
            model: config.model,
            personRequests: conversation.personRequests,
          },
      thread,
    );
    // El registro duradero es la conversación: el hilo ya cumplió (FR-004).
    await saver.deleteThread(clientMessageId);
    return answer(conversationId, seq, state.turn?.toHuman ? "humano" : "ia", state.sources, state.pendingInfo);
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    return { ok: false, error: providerMessage(e.kind, provider.name, e.model ?? config.model), conversationId };
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

const providerMessage = (kind: ProviderErrorKind, name: string, model: string) =>
  ({
    invalid_key: `${name} rechazó la API key. Revísala en Tu chatbot.`,
    no_credit: `Tu cuenta de ${name} no tiene saldo. Recárgala y vuelve a intentar.`,
    model_unavailable: `El modelo ${model} ya no está disponible en ${name}. Elige otro en Tu chatbot.`,
    timeout: `${name} tardó demasiado en responder. Intenta de nuevo.`,
    unavailable: `No pudimos contactar a ${name}. Intenta de nuevo en unos segundos.`,
  })[kind];
