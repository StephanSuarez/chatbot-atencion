import type { Tool } from "../providers";

// Herramientas de agendamiento (plan 006 §3). El modelo pide; el servidor decide y valida.

export const VER_DISPONIBILIDAD: Tool = {
  name: "ver_disponibilidad",
  description: "Consulta los horarios libres de un día para ofrecerle opciones al cliente.",
  parameters: {
    type: "object",
    properties: {
      fecha: { type: "string", description: "Día a consultar, en formato AAAA-MM-DD." },
    },
    required: ["fecha"],
    additionalProperties: false,
  },
};

export const AGENDAR_CITA: Tool = {
  name: "agendar_cita",
  description: "Agenda la cita en el calendario de la empresa. Úsala solo cuando el cliente ya confirmó horario, nombre y contacto.",
  parameters: {
    type: "object",
    properties: {
      fecha_hora: { type: "string", description: "Inicio de la cita, en formato AAAA-MM-DDTHH:MM:00." },
      nombre: { type: "string", description: "Nombre del cliente, tal como lo dio." },
      contacto: { type: "string", description: "Teléfono o correo del cliente." },
      motivo: { type: "string", description: "Para qué es la cita, en pocas palabras." },
    },
    required: ["fecha_hora", "nombre", "contacto", "motivo"],
    additionalProperties: false,
  },
};

// Reglas que se añaden al prompt cuando hay cuenta conectada y horario configurado (FR-007).
export const SCHEDULING_RULES = [
  "Puedes agendar citas. Para ofrecer horarios usa ver_disponibilidad con la fecha que te interese; nunca inventes horarios.",
  "Antes de agendar, pide el nombre del cliente y un teléfono o correo, y confirma con él la fecha y la hora elegidas.",
  "Solo cuando el cliente confirme, usa agendar_cita. Después dile la fecha y la hora exactas que quedaron agendadas.",
];

// Regla que se usa mientras el agendamiento no está listo (viene de la 003).
export const NO_SCHEDULING_RULE = "Agendar citas todavía no está disponible: si te piden una, di que por ahora no puedes agendarla.";

const MAX_TEXT = 200;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const text = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "");

function parsed(args: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(args.trim() || "{}");
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Día a consultar. Los argumentos son salida del modelo: no confiable (principio 3). */
export function parseAvailability(args: string): string | null {
  const day = text(parsed(args)?.fecha);
  return DAY.test(day) ? day : null;
}

export interface BookingRequest {
  startIso: string;
  name: string;
  contact: string;
  motive: string;
}

export function parseBooking(args: string): BookingRequest | null {
  const values = parsed(args);
  if (!values) return null;
  const startIso = text(values.fecha_hora);
  const name = text(values.nombre);
  const contact = text(values.contacto);
  if (!DATE_TIME.test(startIso) || !name || !contact) return null;
  return {
    startIso: startIso.length === 16 ? `${startIso}:00` : startIso,
    name,
    contact,
    motive: text(values.motivo),
  };
}
