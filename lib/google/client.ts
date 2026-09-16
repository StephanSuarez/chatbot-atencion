// Cliente de Google: OAuth y calendario (plan 006 §6). Endpoints y parámetros verificados en la
// documentación oficial el 2026-09-15. No sabe nada de citas ni de horarios: eso es del servicio de agenda.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_URL = "https://www.googleapis.com/calendar/v3";

// calendar.events crea eventos; calendar.freebusy consulta la ocupación. freeBusy no acepta
// calendar.events (verificado), así que hacen falta los dos, y aun así es menos que «calendar».
export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

const TIMEOUT_MS = 10_000;

export type GoogleErrorKind = "sin_permiso" | "no_disponible" | "caido";

export class GoogleError extends Error {
  constructor(readonly kind: GoogleErrorKind) {
    super(`google: ${kind}`);
  }
}

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface Busy {
  start: string;
  end: string;
}

/** A dónde se manda a la persona para que autorice. `state` protege de CSRF. */
export function consentUrl(credentials: GoogleCredentials, state: string): string {
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: credentials.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    // Sin access_type=offline no llega refresh token; prompt=consent lo fuerza aunque ya hubiera autorizado.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function request(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw fail("caido");
  }
  if (response.status === 401 || response.status === 403) throw fail("sin_permiso");
  if (!response.ok) throw fail(response.status === 409 ? "no_disponible" : "caido");
  try {
    return await response.json();
  } catch {
    throw fail("caido");
  }
}

const form = (values: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(values).toString(),
});

/** Cambia el código de autorización por tokens. El refresh token solo llega la primera vez. */
export async function exchangeCode(credentials: GoogleCredentials, code: string) {
  const body = (await request(
    TOKEN_URL,
    form({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: credentials.redirectUri,
      grant_type: "authorization_code",
    }),
  )) as { access_token?: unknown; refresh_token?: unknown };

  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
  if (!accessToken || !refreshToken) throw fail("sin_permiso");
  return { accessToken, refreshToken };
}

export async function refreshAccessToken(credentials: GoogleCredentials, refreshToken: string): Promise<string> {
  const body = (await request(
    TOKEN_URL,
    form({
      refresh_token: refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "refresh_token",
    }),
  )) as { access_token?: unknown };
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw fail("sin_permiso");
  return accessToken;
}

/** Correo de la cuenta conectada, para mostrarlo en la configuración. */
export async function connectedEmail(accessToken: string): Promise<string> {
  const body = (await request(`${CALENDAR_URL}/calendars/primary`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })) as { id?: unknown; summary?: unknown };
  return typeof body.id === "string" ? body.id : typeof body.summary === "string" ? body.summary : "";
}

/** Franjas ocupadas del calendario entre dos instantes (RFC 3339). */
export async function busyPeriods(accessToken: string, calendarId: string, timeMin: string, timeMax: string): Promise<Busy[]> {
  const body = (await request(`${CALENDAR_URL}/freeBusy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: calendarId }] }),
  })) as { calendars?: Record<string, { busy?: unknown }> };

  const busy = body.calendars?.[calendarId]?.busy;
  if (!Array.isArray(busy)) return [];
  return busy.filter(
    (period): period is Busy => typeof period?.start === "string" && typeof period?.end === "string",
  );
}

export interface NewEvent {
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  timeZone: string;
}

/** Crea el evento. Devuelve su id, que sirve para encontrarlo si la respuesta se pierde. */
export async function createEvent(accessToken: string, calendarId: string, event: NewEvent): Promise<string> {
  const body = (await request(`${CALENDAR_URL}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.startIso, timeZone: event.timeZone },
      end: { dateTime: event.endIso, timeZone: event.timeZone },
    }),
  })) as { id?: unknown };
  return typeof body.id === "string" ? body.id : "";
}

function fail(kind: GoogleErrorKind): GoogleError {
  // Nunca se registran tokens ni datos del cliente (plan §7).
  console.error(`[google] ${kind}`);
  return new GoogleError(kind);
}
