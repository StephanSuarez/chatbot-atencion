import type { Tool } from "../providers";

// La herramienta que se le ofrece al modelo para pasar la conversación a una persona (plan 004 §4).

export type Reason = "no_sabe" | "enojo" | "pide_persona";
const REASONS: Reason[] = ["no_sabe", "enojo", "pide_persona"];

export interface Derivation {
  reason: Reason;
  message: string;
  note: string;
}

const MAX_TEXT = 2000;

export const DERIVAR: Tool = {
  name: "derivar",
  description:
    "Pasa la conversación a una persona del equipo. Úsala cuando la información de referencia no alcance para responder, " +
    "cuando el cliente esté claramente enojado, o cuando pida hablar con una persona.",
  parameters: {
    type: "object",
    properties: {
      motivo: { type: "string", enum: REASONS },
      mensaje_al_cliente: { type: "string", description: "Lo que se le responde al cliente antes de pasar con una persona." },
      nota: {
        type: "string",
        description: "Explicación para el equipo: qué preguntó el cliente y qué información faltó, o qué pasó.",
      },
    },
    required: ["motivo", "mensaje_al_cliente", "nota"],
    additionalProperties: false,
  },
};

export const REASON_LABEL: Record<Reason, string> = {
  no_sabe: "no tiene la información",
  enojo: "cliente enojado",
  pide_persona: "pidió hablar con una persona",
};

export const HANDOFF_MESSAGE = "No tengo esa información. Voy a consultar: una persona del equipo va a continuar esta conversación.";
// La primera vez que piden una persona el bot ofrece ayudar él mismo; el servidor lleva la cuenta (FR-009).
export const FIRST_PERSON_REQUEST =
  "Con gusto te ayudo yo. ¿Qué necesitas? Si prefieres hablar con una persona, vuelve a pedírmelo y te paso con el equipo.";

// Los argumentos son salida del modelo, no confiable (principio 3): sin un motivo válido no se puede derivar.
export function parseDerivation(args: string): Derivation | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args.trim() || "{}");
  } catch {
    return null;
  }
  const { motivo, mensaje_al_cliente, nota } = (parsed ?? {}) as Record<string, unknown>;
  if (typeof motivo !== "string" || !REASONS.includes(motivo as Reason)) return null;
  const reason = motivo as Reason;
  return {
    reason,
    message: text(mensaje_al_cliente) || HANDOFF_MESSAGE,
    note: text(nota) || `Motivo: ${REASON_LABEL[reason]}.`,
  };
}

const text = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "");
