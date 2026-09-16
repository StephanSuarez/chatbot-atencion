import { busyPeriods, createEvent, GoogleError, refreshAccessToken, type Busy } from "../google/client";
import { appCredentials, getConnection, getRefreshToken, type Agenda } from "../google/config";

// Reglas del agendamiento (plan 006 §4). No habla HTTP con Google: para eso está lib/google/client.
// ponytail: las horas se manejan como hora local del calendario, asumiendo que el servidor corre en
// esa misma zona. Si algún día el calendario está en otra zona, aquí entra una librería de zonas.

export const TIME_ZONE = process.env.AGENDA_TIME_ZONE ?? "America/Bogota";

export interface Slot {
  startIso: string;
  endIso: string;
  label: string;
}

export type BookReason = "sin_conexion" | "sin_horario" | "dia_no_atendido" | "fuera_de_horario" | "muy_pronto" | "ocupado" | "google";

export type BookResult = { ok: true; startIso: string; endIso: string; eventId: string } | { ok: false; reason: BookReason };

const MINUTE = 60_000;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

const overlaps = (start: Date, end: Date, busy: Busy[]) =>
  busy.some((period) => {
    const from = new Date(period.start);
    const to = new Date(period.end);
    return start < to && end > from;
  });

/** Huecos libres de un día: horario configurado, menos lo ocupado, respetando la anticipación mínima. */
export function freeSlots(input: { day: string; agenda: Agenda; busy: Busy[]; now: Date }): Slot[] {
  const [year, month, dayOfMonth] = input.day.split("-").map(Number);
  if (!year || !month || !dayOfMonth) return [];

  const date = new Date(year, month - 1, dayOfMonth);
  if (!input.agenda.days.includes(date.getDay())) return [];

  const opens = minutesOf(input.agenda.start);
  const closes = minutesOf(input.agenda.end);
  if (!Number.isFinite(opens) || !Number.isFinite(closes) || closes <= opens) return [];

  const earliest = new Date(input.now.getTime() + input.agenda.minNoticeHours * 60 * MINUTE);
  const slots: Slot[] = [];
  for (let minute = opens; minute + input.agenda.slotMinutes <= closes; minute += input.agenda.slotMinutes) {
    const start = new Date(year, month - 1, dayOfMonth, 0, minute);
    const end = new Date(start.getTime() + input.agenda.slotMinutes * MINUTE);
    if (start < earliest) continue;
    if (overlaps(start, end, input.busy)) continue;
    slots.push({ startIso: iso(start), endIso: iso(end), label: `${pad(start.getHours())}:${pad(start.getMinutes())}` });
  }
  return slots;
}

/** Los huecos de un día consultando la ocupación real del calendario. */
export async function availability(day: string, now = new Date()): Promise<{ ok: true; slots: Slot[] } | { ok: false; reason: BookReason }> {
  const context = await connect();
  if (!context.ok) return context;

  try {
    const dayStart = new Date(`${day}T00:00:00`);
    if (Number.isNaN(dayStart.getTime())) return { ok: false, reason: "fuera_de_horario" };
    const busy = await busyPeriods(
      context.accessToken,
      context.calendarId,
      dayStart.toISOString(),
      new Date(dayStart.getTime() + 24 * 60 * MINUTE).toISOString(),
    );
    return { ok: true, slots: freeSlots({ day, agenda: context.agenda, busy, now }) };
  } catch (e) {
    return googleFailure(e);
  }
}

/**
 * Crea la cita. Vuelve a validar horario, anticipación y disponibilidad justo antes de escribir:
 * entre ofrecer un hueco y confirmarlo pueden pasar minutos (plan §12).
 */
export async function bookAppointment(input: {
  startIso: string;
  name: string;
  contact: string;
  motive: string;
  now?: Date;
}): Promise<BookResult> {
  const now = input.now ?? new Date();
  const context = await connect();
  if (!context.ok) return context;

  const start = new Date(input.startIso);
  if (Number.isNaN(start.getTime())) return { ok: false, reason: "fuera_de_horario" };
  const day = input.startIso.slice(0, 10);

  if (!context.agenda.days.includes(start.getDay())) return { ok: false, reason: "dia_no_atendido" };
  if (start.getTime() < now.getTime() + context.agenda.minNoticeHours * 60 * MINUTE) return { ok: false, reason: "muy_pronto" };

  try {
    const end = new Date(start.getTime() + context.agenda.slotMinutes * MINUTE);
    const busy = await busyPeriods(context.accessToken, context.calendarId, start.toISOString(), end.toISOString());

    const offered = freeSlots({ day, agenda: context.agenda, busy, now });
    if (!offered.some((slot) => slot.startIso === iso(start))) {
      return { ok: false, reason: overlaps(start, end, busy) ? "ocupado" : "fuera_de_horario" };
    }

    const eventId = await createEvent(context.accessToken, context.calendarId, {
      summary: `Cita: ${input.name}`,
      description: [input.motive, `Contacto: ${input.contact}`].filter(Boolean).join("\n"),
      startIso: iso(start),
      endIso: iso(end),
      timeZone: TIME_ZONE,
    });
    return { ok: true, startIso: iso(start), endIso: iso(end), eventId };
  } catch (e) {
    return googleFailure(e);
  }
}

type Context = { ok: true; accessToken: string; calendarId: string; agenda: Agenda } | { ok: false; reason: BookReason };

/** Cuenta conectada y horario configurado; sin las dos cosas el bot no agenda (FR-005). */
async function connect(): Promise<Context> {
  const credentials = appCredentials();
  const connection = await getConnection();
  const refreshToken = await getRefreshToken();
  if (!credentials || !connection || !refreshToken) return { ok: false, reason: "sin_conexion" };
  if (!connection.agenda) return { ok: false, reason: "sin_horario" };

  try {
    const accessToken = await refreshAccessToken(credentials, refreshToken);
    return { ok: true, accessToken, calendarId: connection.calendarId, agenda: connection.agenda };
  } catch (e) {
    return googleFailure(e);
  }
}

function googleFailure(e: unknown): { ok: false; reason: BookReason } {
  if (!(e instanceof GoogleError)) throw e;
  return { ok: false, reason: e.kind === "sin_permiso" ? "sin_conexion" : "google" };
}
