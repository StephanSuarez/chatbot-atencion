import { cookies } from "next/headers";
import { connectedEmail, exchangeCode, GoogleError } from "../../../../lib/google/client";
import { appCredentials, saveConnection } from "../../../../lib/google/config";

// Vuelta del consentimiento de Google (plan 006 §3). Es la única ruta HTTP del proyecto: el resto
// son server actions. Google solo sabe redirigir con GET.

export const STATE_COOKIE = "google_oauth_state";

// El destino se arma sobre la URL de la propia petición: no depende de que la variable de entorno
// esté puesta, y Response.redirect exige una URL absoluta.
const back = (request: Request, result: string) =>
  Response.redirect(new URL(`/?google=${result}`, request.url), 303);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // Si la persona cancela en la pantalla de Google, vuelve con error y sin código.
  if (url.searchParams.get("error") || !code) return back(request, "cancelado");

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  // Sin este control, un tercero podría hacer que conectes su cuenta con un enlace preparado (CSRF).
  if (!expected || !state || state !== expected) return back(request, "estado_invalido");

  const credentials = appCredentials();
  if (!credentials) return back(request, "sin_credenciales");

  try {
    const { accessToken, refreshToken } = await exchangeCode(credentials, code);
    const email = await connectedEmail(accessToken);
    await saveConnection({ refreshToken, email, calendarId: email || "primary" });
    return back(request, "conectado");
  } catch (e) {
    if (!(e instanceof GoogleError)) throw e;
    return back(request, e.kind === "sin_permiso" ? "sin_permiso" : "fallo");
  }
}
