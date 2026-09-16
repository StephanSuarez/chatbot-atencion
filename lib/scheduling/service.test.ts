import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleError } from "../google/client";
import type { Agenda } from "../google/config";

// Google y la configuración son falsos: aquí se prueban las reglas del agendamiento (plan 006 §9).
const fake = vi.hoisted(() => ({
  connection: null as { email: string; calendarId: string; agenda: Agenda | null } | null,
  refreshToken: null as string | null,
  busy: [] as { start: string; end: string }[],
}));

const refreshAccessToken = vi.hoisted(() => vi.fn(async () => "ya29.token"));
const busyPeriods = vi.hoisted(() => vi.fn(async () => fake.busy));
const createEvent = vi.hoisted(() =>
  vi.fn<(token: string, calendarId: string, event: import("../google/client").NewEvent) => Promise<string>>(async () => "evento-1"),
);

vi.mock("../google/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../google/client")>()),
  refreshAccessToken,
  busyPeriods,
  createEvent,
}));
vi.mock("../google/config", () => ({
  appCredentials: () => ({ clientId: "id", clientSecret: "s", redirectUri: "http://localhost:3000/api/google/callback" }),
  getConnection: async () => fake.connection,
  getRefreshToken: async () => fake.refreshToken,
}));

const { availability, bookAppointment, freeSlots } = await import("./service");

// Miércoles 16 de septiembre de 2026, 9:00 de la mañana.
const now = new Date(2026, 8, 16, 9, 0);
const agenda: Agenda = { days: [1, 2, 3, 4, 5], start: "09:00", end: "12:00", slotMinutes: 30, minNoticeHours: 2 };

beforeEach(() => {
  fake.connection = { email: "cafe@aurora.com", calendarId: "cafe@aurora.com", agenda };
  fake.refreshToken = "1//refresh";
  fake.busy = [];
  refreshAccessToken.mockClear().mockResolvedValue("ya29.token");
  busyPeriods.mockClear();
  createEvent.mockClear().mockResolvedValue("evento-1");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("huecos libres (FR-006)", () => {
  it("ofrece los del horario, respetando la anticipación mínima", () => {
    const slots = freeSlots({ day: "2026-09-16", agenda, busy: [], now });
    // Son las 9:00 y hay 2 horas de anticipación: el primero posible es a las 11:00.
    expect(slots.map((s) => s.label)).toEqual(["11:00", "11:30"]);
  });

  it("descuenta lo que ya está ocupado en el calendario", () => {
    const busy = [{ start: new Date(2026, 8, 17, 9, 30).toISOString(), end: new Date(2026, 8, 17, 10, 30).toISOString() }];
    const slots = freeSlots({ day: "2026-09-17", agenda, busy, now });
    expect(slots.map((s) => s.label)).toEqual(["09:00", "10:30", "11:00", "11:30"]);
  });

  it("un día no atendido no tiene huecos", () => {
    // 19 de septiembre de 2026 es sábado, y la agenda es de lunes a viernes.
    expect(freeSlots({ day: "2026-09-19", agenda, busy: [], now })).toEqual([]);
  });

  it("un día pasado no tiene huecos", () => {
    expect(freeSlots({ day: "2026-09-15", agenda, busy: [], now })).toEqual([]);
  });

  it("no ofrece un hueco que no cabe completo antes de cerrar", () => {
    const corto: Agenda = { ...agenda, start: "09:00", end: "10:10", minNoticeHours: 0 };
    expect(freeSlots({ day: "2026-09-17", agenda: corto, busy: [], now }).map((s) => s.label)).toEqual(["09:00", "09:30"]);
  });
});

describe("disponibilidad y conexión (FR-005)", () => {
  it("sin cuenta conectada no consulta a Google", async () => {
    fake.connection = null;
    fake.refreshToken = null;
    expect(await availability("2026-09-17", now)).toEqual({ ok: false, reason: "sin_conexion" });
    expect(busyPeriods).not.toHaveBeenCalled();
  });

  it("con cuenta pero sin horario configurado, tampoco", async () => {
    fake.connection = { email: "c", calendarId: "c", agenda: null };
    expect(await availability("2026-09-17", now)).toEqual({ ok: false, reason: "sin_horario" });
  });

  it("consulta la ocupación del día y devuelve los huecos", async () => {
    const result = await availability("2026-09-17", now);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.slots.length).toBeGreaterThan(0);
    expect(busyPeriods).toHaveBeenCalledWith("ya29.token", "cafe@aurora.com", expect.any(String), expect.any(String));
  });

  it("si el permiso caducó, se trata como sin conexión", async () => {
    refreshAccessToken.mockRejectedValue(new GoogleError("sin_permiso"));
    expect(await availability("2026-09-17", now)).toEqual({ ok: false, reason: "sin_conexion" });
  });
});

describe("agendar (FR-008, FR-009)", () => {
  it("crea el evento con la duración configurada y devuelve la hora exacta", async () => {
    const result = await bookAppointment({
      startIso: "2026-09-17T10:00:00",
      name: "Ana",
      contact: "3001234567",
      motive: "Pedido para evento",
      now,
    });

    expect(result).toEqual({ ok: true, startIso: "2026-09-17T10:00:00", endIso: "2026-09-17T10:30:00", eventId: "evento-1" });
    const [, , event] = createEvent.mock.calls[0];
    expect(event).toMatchObject({
      summary: "Cita: Ana",
      startIso: "2026-09-17T10:00:00",
      endIso: "2026-09-17T10:30:00",
      timeZone: expect.any(String),
    });
    expect(event.description).toContain("3001234567");
  });

  it("rechaza un hueco ocupado sin crear nada", async () => {
    fake.busy = [{ start: new Date(2026, 8, 17, 10, 0).toISOString(), end: new Date(2026, 8, 17, 10, 30).toISOString() }];
    expect(await bookAppointment({ startIso: "2026-09-17T10:00:00", name: "Ana", contact: "300", motive: "x", now })).toEqual({
      ok: false,
      reason: "ocupado",
    });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["un sábado", "2026-09-19T10:00:00", "dia_no_atendido"],
    ["fuera del horario", "2026-09-17T18:00:00", "fuera_de_horario"],
    ["sin la anticipación mínima", "2026-09-16T09:30:00", "muy_pronto"],
  ] as const)("rechaza %s", async (_, startIso, reason) => {
    expect(await bookAppointment({ startIso, name: "Ana", contact: "300", motive: "x", now })).toEqual({ ok: false, reason });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("si Google se cae al crear, lo dice y no inventa la cita (FR-010)", async () => {
    createEvent.mockRejectedValue(new GoogleError("caido"));
    expect(await bookAppointment({ startIso: "2026-09-17T10:00:00", name: "Ana", contact: "300", motive: "x", now })).toEqual({
      ok: false,
      reason: "google",
    });
  });
});
