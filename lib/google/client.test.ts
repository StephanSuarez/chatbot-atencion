import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { busyPeriods, consentUrl, createEvent, exchangeCode, GoogleError, refreshAccessToken, SCOPES } from "./client";

// Las respuestas siguen la forma documentada por Google (verificada el 2026-09-15); no se pueden grabar
// sin una cuenta real conectada.
const credentials = { clientId: "id-de-la-app", clientSecret: "secreto", redirectUri: "http://localhost:3000/api/google/callback" };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const respond = (status: number, body: unknown) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }));

async function kind(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(GoogleError);
  return (error as GoogleError).kind;
}

describe("consentimiento", () => {
  it("pide permiso duradero y los dos permisos necesarios", () => {
    const url = new URL(consentUrl(credentials, "estado-aleatorio"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("estado-aleatorio");
    expect(url.searchParams.get("scope")).toBe(SCOPES.join(" "));
    expect(url.searchParams.get("redirect_uri")).toBe(credentials.redirectUri);
  });
});

describe("tokens", () => {
  it("cambia el código por tokens y manda las credenciales de la app", async () => {
    respond(200, { access_token: "ya29.token", refresh_token: "1//refresh" });
    expect(await exchangeCode(credentials, "codigo")).toEqual({ accessToken: "ya29.token", refreshToken: "1//refresh" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const sent = new URLSearchParams(init.body);
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code")).toBe("codigo");
    expect(sent.get("client_secret")).toBe("secreto");
  });

  it("sin refresh token no sirve: se trata como permiso no concedido", async () => {
    respond(200, { access_token: "ya29.token" });
    expect(await kind(exchangeCode(credentials, "codigo"))).toBe("sin_permiso");
  });

  it("renueva el token de acceso", async () => {
    respond(200, { access_token: "ya29.nuevo" });
    expect(await refreshAccessToken(credentials, "1//refresh")).toBe("ya29.nuevo");
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("grant_type")).toBe("refresh_token");
  });

  it.each([
    ["401", 401, "sin_permiso"],
    ["403", 403, "sin_permiso"],
    ["500", 500, "caido"],
  ] as const)("%s → %s", async (_, status, expected) => {
    respond(status, { error: "x" });
    expect(await kind(refreshAccessToken(credentials, "1//refresh"))).toBe(expected);
  });

  it("si Google no responde a tiempo → caido", async () => {
    fetchMock.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    expect(await kind(exchangeCode(credentials, "codigo"))).toBe("caido");
  });
});

describe("calendario", () => {
  it("consulta la ocupación y devuelve las franjas ocupadas", async () => {
    respond(200, {
      kind: "calendar#freeBusy",
      calendars: { "cafe@aurora.com": { busy: [{ start: "2026-09-16T15:00:00Z", end: "2026-09-16T16:00:00Z" }] } },
    });
    const busy = await busyPeriods("ya29.token", "cafe@aurora.com", "2026-09-16T00:00:00Z", "2026-09-17T00:00:00Z");
    expect(busy).toEqual([{ start: "2026-09-16T15:00:00Z", end: "2026-09-16T16:00:00Z" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(JSON.parse(init.body)).toEqual({
      timeMin: "2026-09-16T00:00:00Z",
      timeMax: "2026-09-17T00:00:00Z",
      items: [{ id: "cafe@aurora.com" }],
    });
  });

  it("un calendario sin franjas ocupadas devuelve una lista vacía", async () => {
    respond(200, { calendars: { "cafe@aurora.com": {} } });
    expect(await busyPeriods("ya29.token", "cafe@aurora.com", "a", "b")).toEqual([]);
  });

  it("crea el evento con fecha, hora y zona horaria", async () => {
    respond(200, { id: "evento-123" });
    const id = await createEvent("ya29.token", "cafe@aurora.com", {
      summary: "Cita con Ana",
      description: "Consulta sobre pedidos para eventos",
      startIso: "2026-09-17T10:00:00",
      endIso: "2026-09-17T10:30:00",
      timeZone: "America/Bogota",
    });
    expect(id).toBe("evento-123");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/cafe%40aurora.com/events");
    expect(JSON.parse(init.body)).toMatchObject({
      start: { dateTime: "2026-09-17T10:00:00", timeZone: "America/Bogota" },
      end: { dateTime: "2026-09-17T10:30:00", timeZone: "America/Bogota" },
    });
  });

  it("el permiso revocado se distingue de una caída", async () => {
    respond(403, { error: "insufficientPermissions" });
    expect(await kind(createEvent("ya29.token", "c", { summary: "x", description: "", startIso: "a", endIso: "b", timeZone: "z" }))).toBe(
      "sin_permiso",
    );
  });
});
