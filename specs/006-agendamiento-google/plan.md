# Plan técnico — 006 Agendamiento con Google

- **Estado:** Approved (2026-09-15)
- **Fecha:** 2026-09-15
- **Spec:** `specs/006-agendamiento-google/spec.md` (Approved)

> Aprobado por delegación del usuario (2026-09-15).

## 1. Contexto

El bot pasa a agendar citas en el calendario de Google de la empresa. Hay tres partes: conectar la cuenta (OAuth), configurar cuándo se atiende, y agendar conversando.

Restricciones que guían el diseño:
- **Principio 3:** se pide el permiso mínimo y el token se guarda cifrado, como la API key.
- **Principio 8:** si algo falla, el bot no inventa una cita; deriva (004).
- **Reutilizar:** el cifrado de `lib/crypto.ts`, el tool calling de la 004 y la única fila de configuración.

## 2. Estado actual

- **Configuración** (`lib/config-service.ts` + `chatbot_config`, una sola fila): nombre, prompt, proveedor, modelo y API key cifrada con AES-256-GCM (`lib/crypto.ts`, clave en `ENCRYPTION_KEY`).
- **Chat** (`lib/chat/`): arma el prompt y ofrece la herramienta `derivar`; ya sabe interpretar llamadas a herramientas.
- **Reglas fijas** (`FIXED_RULES` y `lib/chat/prompt.ts`): hoy dicen «agendar citas todavía no está disponible». Eso cambia aquí.
- **Sin rutas HTTP propias:** todo son server actions. El callback de OAuth será la primera ruta (`route.ts`).

## 3. Arquitectura propuesta

```
«Tu chatbot»  ──► «Conectar Google»
                     │  redirige a accounts.google.com (consentimiento)
                     ▼
        app/api/google/callback/route.ts  ── cambia el código por tokens
                     │  guarda refresh token cifrado + correo + calendario
                     ▼
              Configuración (chatbot_config)

Cliente pide cita ──► Servicio de chat ──► herramientas
                                            ├─ ver_disponibilidad(fecha)
                                            └─ agendar_cita(...)
                                                  │
                                       Servicio de agenda
                                        ├─ valida horario y anticipación
                                        ├─ consulta huecos ocupados (Google)
                                        └─ crea el evento (Google)
```

**Flujo de la conexión:** el botón lleva a `https://accounts.google.com/o/oauth2/v2/auth` con `client_id`, `redirect_uri`, `response_type=code`, `scope`, `access_type=offline`, `prompt=consent` y un `state` aleatorio guardado en cookie. El callback valida el `state`, cambia el código por tokens en `https://oauth2.googleapis.com/token` y guarda el **refresh token cifrado**. *(endpoints y parámetros verificados en la documentación oficial de Google el 2026-09-15)*

**Flujo de una cita:** el modelo pide `ver_disponibilidad`; el servidor calcula los huecos del día dentro del horario configurado, descontando lo ocupado en el calendario, y se los devuelve. Cuando el cliente elige y da sus datos, el modelo pide `agendar_cita`; el servidor **vuelve a validar** horario, anticipación y disponibilidad, y solo entonces crea el evento.

## 4. Componentes y responsabilidades

| Componente | Responsabilidad | No debe |
|---|---|---|
| **Cliente de Google** (nuevo, `lib/google/`) | Construir la URL de consentimiento, cambiar el código por tokens, renovar el token de acceso, listar ocupación y crear eventos. Traducir fallos a tipos (`sin_permiso`, `no_disponible`, `caido`) | Saber de citas ni de horarios |
| **Servicio de agenda** (nuevo, `lib/scheduling/`) | Reglas de negocio: horario, duración, anticipación, huecos libres, crear la cita validando de nuevo | Hablar HTTP con Google |
| **Configuración** (existe) | Guarda el refresh token cifrado, el correo conectado, el calendario y los ajustes de agenda | Mostrar el token |
| **Servicio de chat** (existe) | Ofrece las dos herramientas nuevas cuando el agendamiento está listo; si Google falla, deriva | Llamar a Google directamente |
| **Ruta de callback** (nueva, `app/api/google/callback/route.ts`) | Validar `state`, cambiar el código por tokens, guardar y redirigir | Contener reglas de negocio |
| **Pantalla «Tu chatbot»** (existe) | Conectar y desconectar, mostrar la cuenta y editar el horario de atención | — |

## 5. Datos y persistencia

Migración `0004`, sobre la única fila de `chatbot_config`:
- `google_refresh_token_encrypted`, `google_email`, `google_calendar_id`.
- `agenda_days` (días de la semana), `agenda_start`, `agenda_end`, `agenda_slot_minutes`, `agenda_min_notice_hours`.

No se guarda ninguna tabla de citas: la cita vive en el calendario de Google. Del cliente solo queda lo que él mismo dio, dentro del evento y de la conversación (FR-011).

## 6. Integraciones externas

**Google OAuth** *(verificado el 2026-09-15)*
- Consentimiento: `https://accounts.google.com/o/oauth2/v2/auth`; tokens: `https://oauth2.googleapis.com/token`.
- `access_type=offline` es lo que devuelve el refresh token; `prompt=consent` fuerza que lo devuelva aunque ya se hubiera autorizado antes.
- Renovar: `POST` al mismo endpoint con `grant_type=refresh_token`.
- **Credenciales de la aplicación** (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`) van en variables de entorno, no en la base: son del proyecto, no del usuario final.

**Google Calendar** *(endpoint de creación verificado el 2026-09-15)*
- Crear: `POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events`, con `start` y `end` como `dateTime` + `timeZone`.
- Permiso pedido: `https://www.googleapis.com/auth/calendar.events`, el mínimo que permite crear y leer eventos.
- **Consulta de ocupación: no verificada todavía.** Se usará el listado de eventos del día (`GET .../events` con `timeMin`, `timeMax`, `singleEvents=true`) o `freeBusy`; **se confirma con la documentación al implementar**, igual que se hizo con los códigos de error de los proveedores en la 003.

**Route Handler** *(verificado en la documentación de Next 16.3.5 incluida en el repo)*: `app/api/google/callback/route.ts` con `export async function GET(request: Request)`. No se cachea por defecto.

## 7. Seguridad y privacidad

- **Refresh token cifrado** con la misma utilidad que la API key; nunca viaja al navegador ni se muestra.
- **`state` aleatorio en cookie** para que un tercero no pueda completar la conexión (CSRF).
- **Permiso mínimo:** solo `calendar.events`.
- **Salida del modelo no confiable:** fecha, hora, nombre y contacto se validan en el servidor antes de crear nada.
- **Validación doble:** el hueco se comprueba justo antes de crear el evento, no solo al ofrecerlo.
- **Logs:** sin tokens, sin datos del cliente; solo resultado y tipo de error.

## 8. Modos de fallo y casos borde

| Situación | Comportamiento |
|---|---|
| Sin cuenta conectada o sin horario | Las herramientas no se ofrecen; el bot dice que no puede agendar |
| Permiso revocado o caducado (401/403) | Se marca la cuenta como desconectada, el bot avisa y deriva (FR-010) |
| Google caído o lento | El bot avisa y deriva; no inventa la cita |
| El hueco se ocupó entre ofrecer y agendar | Se rechaza y se ofrecen alternativas (FR-009) |
| El modelo manda una fecha imposible o pasada | El servidor la rechaza y el bot explica el horario |
| El evento se crea pero la respuesta se pierde | Riesgo aceptado: puede quedar una cita creada sin confirmación al cliente; queda anotado en §13 |

## 9. Estrategia de pruebas

| Qué | Tipo |
|---|---|
| Servicio de agenda: huecos dentro del horario, anticipación mínima, hueco ocupado, día no atendido, fecha pasada | Unitarias con reloj fijo y calendario falso |
| Cliente de Google: forma de las peticiones y traducción de 401/403/5xx | Unitarias con respuestas grabadas |
| Servicio de chat: ofrece las herramientas solo si está listo; agenda; deriva si Google falla | Integración con proveedor falso |
| Conexión OAuth (state, guardado cifrado) | Integración con el endpoint de tokens simulado |
| SC-001…SC-005 | Manual, **requiere credenciales de Google del usuario** |

## 10. Observabilidad

Log por intento de cita: si se creó o no, el motivo del rechazo y el tipo de error de Google. Sin datos del cliente ni tokens.

## 11. Despliegue y migración

- Migración `0004` (columnas nuevas, todas opcionales).
- Variables nuevas: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
- El `redirect_uri` debe coincidir exactamente con el registrado en Google Cloud; en local será `http://localhost:3000/api/google/callback`.

## 12. Decisiones y alternativas

| Decisión | Alternativas | Razón |
|---|---|---|
| **OAuth con refresh token cifrado** | Cuenta de servicio | Una cuenta de servicio no puede escribir en el calendario personal de la empresa sin delegación de Workspace; el OAuth sirve para cualquier cuenta |
| **Dos herramientas (ver disponibilidad y agendar)** | Una sola que agende directo | El bot necesita ofrecer huecos reales antes de pedir datos; y separa consultar de escribir |
| **Validar otra vez al agendar** | Confiar en el hueco ofrecido | Entre ofrecer y confirmar pueden pasar minutos: el hueco puede ocuparse |
| **Sin tabla de citas** | Guardar las citas también en nuestra base | La cita ya vive en el calendario; duplicarla obliga a sincronizar (principio 4) |
| **Ajustes de agenda en `chatbot_config`** | Tabla aparte | Hay una sola configuración; una tabla nueva no aporta |
| **Permiso `calendar.events`** | `calendar` completo | Mínimo privilegio (principio 3) |

## 13. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Sin credenciales de Google del usuario no se puede probar de punta a punta** | La feature queda implementada pero sin validar | Se avisa al usuario; los tests usan respuestas simuladas |
| El modelo interpreta mal «mañana a las 3» | Cita en hora equivocada | El servidor valida y el bot confirma fecha y hora exactas antes y después de crear |
| El evento se crea y la respuesta se pierde | Cita huérfana | Anotado; se puede mitigar buscando por un identificador propio en el evento |
| Zona horaria distinta entre servidor y calendario | Citas con una hora de desfase | Se usa la zona horaria del calendario, y se prueba con una zona distinta a la del servidor |
| Consulta de ocupación aún sin verificar | Retrabajo pequeño al implementar | Se confirma con la documentación antes de escribir el cliente |

## 14. Preguntas técnicas abiertas

- Cómo se consulta la ocupación (listado de eventos o `freeBusy`): se decide al implementar, leyendo la documentación oficial.
