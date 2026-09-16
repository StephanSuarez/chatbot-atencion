"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { consentUrl } from "../lib/google/client";
import { appCredentials, disconnect, saveAgenda, type Agenda } from "../lib/google/config";
import { STATE_COOKIE } from "./api/google/callback/route";

// Conexión con Google y horario de atención (006). Sin login (principio 11): el servicio valida lo que llega.

const PATH = "/";
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLOTS = [15, 20, 30, 45, 60, 90, 120];
const NOTICE = [0, 1, 2, 4, 12, 24, 48];

export type Result = { ok: boolean; error?: string };

/** Devuelve a dónde mandar a la persona para autorizar. El `state` viaja en cookie y se compara en el callback. */
export async function startGoogleConnectionAction(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const credentials = appCredentials();
  if (!credentials) {
    return { ok: false, error: "Faltan las credenciales de Google de la aplicación (GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET)." };
  }
  const state = randomBytes(24).toString("base64url");
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return { ok: true, url: consentUrl(credentials, state) };
}

export async function disconnectGoogleAction(): Promise<Result> {
  try {
    await disconnect();
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    console.error("[google] no se pudo desconectar:", e instanceof Error ? e.message : e);
    return { ok: false, error: "No pudimos desconectar la cuenta. Intenta de nuevo." };
  }
}

export async function saveAgendaAction(input: {
  days?: unknown;
  start?: unknown;
  end?: unknown;
  slotMinutes?: unknown;
  minNoticeHours?: unknown;
}): Promise<Result> {
  const days = Array.isArray(input?.days)
    ? [...new Set(input.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : [];
  const start = typeof input?.start === "string" ? input.start : "";
  const end = typeof input?.end === "string" ? input.end : "";
  const slotMinutes = Number(input?.slotMinutes);
  const minNoticeHours = Number(input?.minNoticeHours);

  if (!days.length) return { ok: false, error: "Elige al menos un día de atención." };
  if (!HHMM.test(start) || !HHMM.test(end)) return { ok: false, error: "Las horas deben tener el formato 09:00." };
  if (end <= start) return { ok: false, error: "La hora de cierre tiene que ser posterior a la de apertura." };
  if (!SLOTS.includes(slotMinutes)) return { ok: false, error: "Elige una duración de cita válida." };
  if (!NOTICE.includes(minNoticeHours)) return { ok: false, error: "Elige un aviso mínimo válido." };

  const agenda: Agenda = { days, start, end, slotMinutes, minNoticeHours };
  try {
    await saveAgenda(agenda);
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) {
    console.error("[google] no se pudo guardar el horario:", e instanceof Error ? e.message : e);
    return { ok: false, error: "No pudimos guardar el horario. Intenta de nuevo." };
  }
}
