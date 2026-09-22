import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { AGENDAR_CITA, parseAvailability, parseBooking, VER_DISPONIBILIDAD } from "../chat/agendar";
import { DERIVAR, FIRST_PERSON_REQUEST, parseDerivation, REASON_LABEL, type Derivation } from "../chat/derivar";
import { buildMessages, HISTORY_LIMIT } from "../chat/prompt";
import { findRelated, retrievalQuery, type FoundChunk } from "../chat/retrieve";
import { FIXED_RULES } from "../config-service";
import { getEntries, saveBotTurn, type Entry } from "../conversations/service";
import { indexPending } from "../kb/indexer";
import { countPendingChunks } from "../kb/service";
import { EMBEDDING_MODEL, ProviderError, type ChatMessage, type ChatResult, type Provider } from "../providers";
import { availability, bookAppointment, canSchedule, type BookReason } from "../scheduling/service";

// El turno del bot como grafo (plan 011 §3, §4): las reglas de las specs 003, 004 y 006, nodo a nodo.
// Lo previo al turno (validar, guardar el mensaje del cliente, modo humano, reintento, adjuntos) queda
// en lib/chat/service.ts.

export type BotTurn = Parameters<typeof saveBotTurn>[1];

const last = <T>(initial: T) => Annotation<T>({ reducer: (_: T, next: T) => next, default: () => initial });

// Todo serializable a JSON: es lo que se guarda en cada checkpoint. Las credenciales van en el contexto.
export const TurnState = Annotation.Root({
  conversationId: Annotation<string>,
  seq: Annotation<number>,
  message: Annotation<string>,
  companyName: Annotation<string>,
  prompt: Annotation<string>,
  model: Annotation<string>,
  personRequests: Annotation<number>,
  startedAt: last(0),
  pendingInfo: last(false),
  canSchedule: last(false),
  history: last<ChatMessage[]>([]),
  sources: last<FoundChunk[]>([]),
  messages: last<ChatMessage[]>([]),
  result: last<ChatResult | null>(null),
  availabilityCalls: last(0),
  turn: last<BotTurn | null>(null),
});

export const TurnContext = Annotation.Root({
  provider: Annotation<Provider>,
  apiKey: Annotation<string>,
});

export type TurnInput = Pick<
  typeof TurnState.State,
  "conversationId" | "seq" | "message" | "companyName" | "prompt" | "model" | "personRequests"
>;

type State = typeof TurnState.State;
type Runtime = { context?: typeof TurnContext.State };

function context(runtime: Runtime) {
  if (!runtime.context) throw new Error("El turno necesita el proveedor y la API key en el contexto de ejecución.");
  return runtime.context;
}

// El nodo sabe qué modelo llamó; el error del proveedor no.
const withModel = (e: unknown, model: string) =>
  e instanceof ProviderError && !e.model ? new ProviderError(e.provider, e.kind, model) : e;

const toolArgs = (result: ChatResult | null) => (result && "tool" in result ? result.args : "");

async function preparar(state: State) {
  // Red de seguridad del plan 002: lo que quedó pendiente se indexa antes de buscar.
  await indexPending();
  const [pendingChunks, scheduling, history] = await Promise.all([
    countPendingChunks(),
    canSchedule(),
    recentHistory(state.conversationId, state.seq),
  ]);
  return { pendingInfo: pendingChunks > 0, canSchedule: scheduling, history, startedAt: Date.now() };
}

async function buscar(state: State, runtime: Runtime) {
  const { provider, apiKey } = context(runtime);
  try {
    return { sources: await findRelated(retrievalQuery(state.history, state.message), provider, apiKey) };
  } catch (e) {
    throw withModel(e, EMBEDDING_MODEL);
  }
}

async function modelo(state: State, runtime: Runtime) {
  const { provider, apiKey } = context(runtime);
  // Los mensajes se arman una vez; la consulta de disponibilidad los amplía y vuelve aquí.
  const messages = state.messages.length
    ? state.messages
    : buildMessages({
        companyName: state.companyName,
        prompt: state.prompt,
        fixedRules: FIXED_RULES,
        found: state.sources,
        history: state.history,
        message: state.message,
        canSchedule: state.canSchedule,
      });
  const tools = state.canSchedule ? [DERIVAR, VER_DISPONIBILIDAD, AGENDAR_CITA] : [DERIVAR];
  try {
    return { messages, result: await provider.chat(messages, state.model, apiKey, tools) };
  } catch (e) {
    throw withModel(e, state.model);
  }
}

// Una sola consulta de disponibilidad por turno, como hasta ahora: la segunda se trata como respuesta
// inválida en `responder`. Permitir más es una decisión de producto pendiente (plan §4).
function siguiente(state: State): "disponibilidad" | "agendar" | "responder" {
  if (!state.result || !("tool" in state.result)) return "responder";
  if (state.result.tool === VER_DISPONIBILIDAD.name && state.availabilityCalls === 0) return "disponibilidad";
  if (state.result.tool === AGENDAR_CITA.name) return "agendar";
  return "responder";
}

// Consultar horarios no termina el turno: se le devuelven al modelo para que redacte la respuesta.
async function disponibilidad(state: State) {
  const day = parseAvailability(toolArgs(state.result));
  const found = day ? await availability(day) : null;
  const slots = found?.ok ? found.slots.map((slot) => slot.label).join(", ") : "";
  const content = slots
    ? `Horarios libres el ${day}: ${slots}. Ofrécelos con estas horas exactas.`
    : `No hay horarios libres el ${day}. Ofrece otro día dentro del horario de atención.`;
  return { messages: [...state.messages, { role: "system" as const, content }], availabilityCalls: state.availabilityCalls + 1 };
}

// Agendar sí termina el turno: el servidor valida y crea la cita, y el bot confirma lo creado.
async function agendar(state: State): Promise<{ turn: BotTurn }> {
  const booking = parseBooking(toolArgs(state.result));
  const booked = booking ? await bookAppointment(booking) : { ok: false as const, reason: "fuera_de_horario" as const };

  if (booked.ok) {
    console.info(`[chat] conv=${state.conversationId}: cita creada`);
    return { turn: { entries: [{ author: "bot", text: bookedMessage(booked.startIso) }] } };
  }
  // Un fallo de Google no puede acabar en una cita inventada: se deriva (FR-010).
  if (booked.reason === "google" || booked.reason === "sin_conexion") {
    return {
      turn: {
        entries: [
          { author: "bot", text: "No pude agendar la cita en este momento. Una persona del equipo va a continuar esta conversación." },
          { author: "nota", text: `Falló el agendamiento (${booked.reason}). El cliente pidió cita para ${booking?.startIso ?? "una fecha no válida"}.` },
          { author: "evento", text: "El bot pasó la conversación a modo humano (falló el agendamiento)." },
        ],
        toHuman: true,
      },
    };
  }
  return { turn: { entries: [{ author: "bot", text: REJECTED[booked.reason] }] } };
}

function responder(state: State, runtime: Runtime): { turn: BotTurn } {
  const { provider } = context(runtime);
  const derivation = derivationOf(state.result!, state.sources.length, provider.id);
  console.info(
    `[chat] ${provider.id} ${state.model} conv=${state.conversationId}: ${state.sources.length} pedazos, mejor ${
      state.sources[0]?.similarity.toFixed(2) ?? "-"
    }, ${derivation ? `derivar=${derivation.reason}` : "respuesta"}, ${Date.now() - state.startedAt} ms`,
  );

  if (derivation && !(derivation.reason === "pide_persona" && state.personRequests === 0)) {
    return {
      turn: {
        entries: [
          { author: "bot", text: derivation.message },
          { author: "nota", text: derivation.note },
          { author: "evento", text: `El bot pasó la conversación a modo humano (${REASON_LABEL[derivation.reason]}).` },
        ],
        toHuman: true,
        handoffReason: derivation.reason,
      },
    };
  }
  // Primer pedido de persona: el bot ofrece ayudar él mismo y el servidor anota el pedido (FR-009).
  if (derivation) return { turn: { entries: [{ author: "bot", text: FIRST_PERSON_REQUEST }], personRequests: 1 } };
  return { turn: { entries: [{ author: "bot", text: (state.result as { text: string }).text }] } };
}

async function guardar(state: State) {
  await saveBotTurn(state.conversationId, state.turn!);
  return {};
}

export function buildTurnGraph(checkpointer: BaseCheckpointSaver) {
  return new StateGraph(TurnState, TurnContext)
    .addNode("preparar", preparar)
    .addNode("buscar", buscar)
    .addNode("modelo", modelo)
    .addNode("disponibilidad", disponibilidad)
    .addNode("agendar", agendar)
    .addNode("responder", responder)
    .addNode("guardar", guardar)
    .addEdge(START, "preparar")
    .addEdge("preparar", "buscar")
    .addEdge("buscar", "modelo")
    .addConditionalEdges("modelo", siguiente, ["disponibilidad", "agendar", "responder"])
    .addEdge("disponibilidad", "modelo")
    .addEdge("agendar", "guardar")
    .addEdge("responder", "guardar")
    .addEdge("guardar", END)
    .compile({ checkpointer });
}

/**
 * Respaldo del plan 004 §4: si no encontró información y el modelo respondió texto diciendo que va a
 * consultar en vez de usar la herramienta, se deriva igual.
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

// Una respuesta del bot puede ser mucho más larga que un mensaje del cliente.
const MAX_HISTORY_CONTENT = 4000;
const ROLE: Record<string, ChatMessage["role"]> = { cliente: "user", bot: "assistant", equipo: "assistant" };

// Un mensaje solo con archivo no tiene texto: sin nombrarlo, el historial le mandaría al modelo un
// mensaje vacío del cliente.
const historyText = (entry: Entry) =>
  (entry.attachment ? `${entry.text} [archivo adjunto: ${entry.attachment.name}]`.trim() : entry.text).slice(
    0,
    MAX_HISTORY_CONTENT,
  );

async function recentHistory(conversationId: string, beforeSeq: number): Promise<ChatMessage[]> {
  const entries = (await getEntries(conversationId, { forClient: true })) ?? [];
  return entries
    .filter((entry) => entry.seq < beforeSeq)
    .slice(-HISTORY_LIMIT)
    .map((entry) => ({ role: ROLE[entry.author], content: historyText(entry) }));
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
