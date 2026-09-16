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
import { availability, bookAppointment, canSchedule, type BookReason } from "../scheduling/service";
import { AGENDAR_CITA, parseAvailability, parseBooking, VER_DISPONIBILIDAD } from "./agendar";
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
  if (!conversation || conversation.mode === "humano") return answer(conversationId, seq, conversation?.mode ?? "ia");

  // Reintento del mismo mensaje: si ya tiene respuesta se devuelve esa; si el proveedor falló antes de
  // responder, no hay respuesta todavía y se vuelve a intentar sin guardar el mensaje otra vez (FR-012).
  if (saved.duplicate) {
    const previous = await answer(conversationId, seq, conversation.mode);
    if (!previous.ok || previous.entries.length > 0) return previous;
  }

  const { provider, apiKey } = credentials;
  const started = Date.now();
  // El mismo tipo de error puede venir de buscar (modelo de embeddings) o de responder (modelo de chat).
  let failingModel = EMBEDDING_MODEL;
  try {
    // Red de seguridad del plan 002: lo que quedó pendiente se indexa antes de buscar.
    await indexPending();
    const pendingInfo = (await countPendingChunks()) > 0;
    const scheduling = await canSchedule();
    const history = await recentHistory(conversationId, seq);
    const sources = await findRelated(retrievalQuery(history, message), provider, apiKey);
    const messages = buildMessages({
      companyName: config.companyName,
      prompt: config.prompt,
      fixedRules: FIXED_RULES,
      found: sources,
      history,
      message,
      canSchedule: scheduling,
    });
    failingModel = config.model;
    const tools = scheduling ? [DERIVAR, VER_DISPONIBILIDAD, AGENDAR_CITA] : [DERIVAR];
    let result = await provider.chat(messages, config.model, apiKey, tools);

    // Consultar horarios no termina el turno: se le devuelven al modelo para que redacte la respuesta.
    if ("tool" in result && result.tool === VER_DISPONIBILIDAD.name) {
      const day = parseAvailability(result.args);
      const found = day ? await availability(day) : null;
      const slots = found?.ok ? found.slots.map((slot) => slot.label).join(", ") : "";
      messages.push({
        role: "system",
        content: slots
          ? `Horarios libres el ${day}: ${slots}. Ofrécelos con estas horas exactas.`
          : `No hay horarios libres el ${day}. Ofrece otro día dentro del horario de atención.`,
      });
      result = await provider.chat(messages, config.model, apiKey, tools);
    }

    // Agendar sí termina el turno: el servidor valida y crea la cita, y el bot confirma lo creado.
    if ("tool" in result && result.tool === AGENDAR_CITA.name) {
      const booking = parseBooking(result.args);
      const booked = booking ? await bookAppointment(booking) : { ok: false as const, reason: "fuera_de_horario" as const };

      if (booked.ok) {
        await saveBotTurn(conversationId, { entries: [{ author: "bot", text: bookedMessage(booked.startIso) }] });
        console.info(`[chat] conv=${conversationId}: cita creada`);
        return answer(conversationId, seq, "ia", sources, pendingInfo);
      }
      // Un fallo de Google no puede acabar en una cita inventada: se deriva (FR-010).
      if (booked.reason === "google" || booked.reason === "sin_conexion") {
        await saveBotTurn(conversationId, {
          entries: [
            { author: "bot", text: "No pude agendar la cita en este momento. Una persona del equipo va a continuar esta conversación." },
            { author: "nota", text: `Falló el agendamiento (${booked.reason}). El cliente pidió cita para ${booking?.startIso ?? "una fecha no válida"}.` },
            { author: "evento", text: "El bot pasó la conversación a modo humano (falló el agendamiento)." },
          ],
          toHuman: true,
        });
        return answer(conversationId, seq, "humano", sources, pendingInfo);
      }
      await saveBotTurn(conversationId, { entries: [{ author: "bot", text: REJECTED[booked.reason] }] });
      return answer(conversationId, seq, "ia", sources, pendingInfo);
    }
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
    return answer(conversationId, seq, "ia", sources, pendingInfo);
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

// Textos de la cita, en el idioma del cliente. La hora que se confirma es la que quedó creada (FR-008).
const bookedMessage = (startIso: string) => {
  const [day, time] = startIso.split("T");
  const [year, month, dayOfMonth] = day.split("-");
  return `Listo, tu cita quedó agendada para el ${dayOfMonth}/${month}/${year} a las ${time.slice(0, 5)}.`;
};

const REJECTED: Record<Exclude<BookReason, "google" | "sin_conexion">, string> = {
  sin_horario: "Todavía no tenemos horarios de atención configurados para agendar citas.",
  dia_no_atendido: "Ese día no atendemos. ¿Te sirve otro día dentro de nuestro horario?",
  fuera_de_horario: "Ese horario está fuera de nuestro horario de atención. ¿Miramos otra hora?",
  muy_pronto: "Ese horario es demasiado pronto para agendar. ¿Te sirve uno más adelante?",
  ocupado: "Ese horario acaba de ocuparse. ¿Quieres que te ofrezca otros disponibles?",
};

const providerMessage = (kind: ProviderErrorKind, name: string, model: string) =>
  ({
    invalid_key: `${name} rechazó la API key. Revísala en Tu chatbot.`,
    no_credit: `Tu cuenta de ${name} no tiene saldo. Recárgala y vuelve a intentar.`,
    model_unavailable: `El modelo ${model} ya no está disponible en ${name}. Elige otro en Tu chatbot.`,
    timeout: `${name} tardó demasiado en responder. Intenta de nuevo.`,
    unavailable: `No pudimos contactar a ${name}. Intenta de nuevo en unos segundos.`,
  })[kind];
