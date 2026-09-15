# Plan técnico — 004 Derivación a humano

- **Estado:** Approved (2026-09-15)
- **Fecha:** 2026-09-15
- **Spec:** `specs/004-derivacion-a-humano/spec.md` (Approved)

## 1. Contexto

Tres cosas nuevas sobre el chat de la 003:
1. **Guardar todas las conversaciones** con su origen, sus mensajes, las notas del bot y los cambios de modo (FR-001…FR-006).
2. **Derivar:** el bot decide si no sabe, si el cliente está enojado o si pide una persona; al derivar escribe una nota y pasa la conversación a modo humano (FR-007…FR-013).
3. **Modo humano:** el equipo responde desde una pestaña «Conversaciones», y los mensajes nuevos aparecen en ambos lados sin recargar (FR-014…FR-020).

Restricciones que guían el diseño:
- **Sin login (principio 11):** cualquiera con el enlace de una conversación puede leerla.
- **Principio 10:** nada de correo ni notificaciones externas; sin dependencias nuevas de infraestructura.
- **Despliegue previsto en Vercel** (funciones sin estado, sin conexiones abiertas largas).

## 2. Estado actual

- **Servicio de chat** (`lib/chat/service.ts`): recibe el historial desde el navegador (no confiable), busca (RAG), arma el prompt y llama a `provider.chat()`. No guarda nada.
- **Armador del prompt** (`lib/chat/prompt.ts`): reglas fijas primero y al final, información delimitada, últimos 10 mensajes.
- **Registro de proveedores** (`lib/providers/`): `chat(mensajes, modelo, key)` devuelve solo texto. Sin herramientas.
- **Lista de modelos de OpenRouter:** filtra por salida de texto; no mira si el modelo acepta herramientas.
- **Pantalla «Probar»** (`app/probar/chat-view.tsx`): la conversación vive en memoria; «Ver en qué se basó» con los pedazos devueltos.
- **Pestañas** (`app/tabs.tsx`): enlaces `<a>`, sin datos.

## 3. Arquitectura propuesta

```
«Probar» (cliente)                           «Conversaciones» (equipo)
  │ enviar(conversación?, idMensaje, texto)     │ listar(filtros) · ver(id) · responder · cambiar modo · borrar
  │ consultar(id, desde) cada 3 s               │ consultar(id, desde) cada 3 s
  ▼                                             ▼
Servicio de conversaciones ── guarda mensajes, modo, notas, eventos (PostgreSQL)
  │ si está en modo IA
  ▼
Servicio de chat (003) ── busca (RAG) ── arma el prompt con la herramienta «derivar»
  │
  ▼
Registro de proveedores: chat(mensajes, modelo, key, herramientas) ──► texto  o  llamada a «derivar»
```

**Flujo de un mensaje del cliente:**
1. El navegador envía el id de la conversación (si ya existe), un id propio del mensaje y el texto.
2. **Guardar** (transacción): crea la conversación si no existe (origen «Chat de prueba», modo IA) y guarda el mensaje. Si el id del mensaje ya existe, no lo duplica (reintento, edge case de la spec).
3. **Si está en modo humano**, termina ahí: el mensaje queda para el equipo (FR-015).
4. **Si está en modo IA:** lee los últimos 10 mensajes **desde la base** (ya no del navegador), busca y llama al modelo con la herramienta `derivar`. La llamada al modelo va **fuera** de la transacción (puede tardar hasta 60 s).
5. **Guardar la respuesta** (transacción, bloqueando la conversación): si mientras el modelo pensaba el equipo pasó la conversación a modo humano, la respuesta se descarta (edge case de la spec). Si no:
   - **Texto normal** → se guarda como mensaje del bot.
   - **Llamada a `derivar`** → se aplican las reglas del §4 (conteo de pedidos), y si corresponde se guardan, en orden: el mensaje del bot al cliente, la nota del bot y el evento «pasó a modo humano (bot)». El modo cambia a humano.
6. Devuelve al navegador los mensajes nuevos visibles para el cliente y, en memoria, los pedazos de «Ver en qué se basó».

**Mensajes nuevos sin recargar:** las dos pantallas preguntan cada 3 s «¿hay mensajes después del último que tengo?» mientras la pestaña está visible. No llama al modelo, así que no gasta saldo.

## 4. Cómo decide el bot: la herramienta `derivar`

Se usa **tool calling** (llamada a herramientas), el mecanismo estándar de OpenAI y OpenRouter: en la petición se describe una herramienta y el modelo, en vez de responder texto, puede pedir usarla. El servidor recibe el pedido y decide qué hacer. Es el mismo mecanismo que usará la 006 para agendar citas.

**Definición** (formato de Chat Completions, verificado en la documentación de OpenAI y de OpenRouter el 2026-09-15):

```json
{
  "type": "function",
  "function": {
    "name": "derivar",
    "description": "Pasa la conversación a una persona del equipo.",
    "parameters": {
      "type": "object",
      "properties": {
        "motivo": { "type": "string", "enum": ["no_sabe", "enojo", "pide_persona"] },
        "mensaje_al_cliente": { "type": "string" },
        "nota": { "type": "string" }
      },
      "required": ["motivo", "mensaje_al_cliente", "nota"],
      "additionalProperties": false
    }
  }
}
```

- `tool_choice: "auto"`: el modelo decide.
- La respuesta llega en `choices[0].message.tool_calls[0].function.arguments`, **como texto JSON**; el servidor lo parsea y valida (principio 3). Si viene mal formado, se deriva igual con una nota que indica solo el motivo si es válido; si ni el motivo es válido, se trata como error del proveedor.
- Las reglas del prompt cambian: «si la información no alcanza, di que vas a consultar» pasa a «si la información no alcanza, usa `derivar` con motivo `no_sabe` y en la nota di qué preguntó el cliente y qué información falta».

**El conteo de «pide una persona» lo lleva el servidor, no el modelo.** Pedirle al modelo que cuente pedidos a lo largo de la conversación es poco fiable, y SC-003 exige que nunca derive al primero. Entonces:
- La conversación guarda cuántas veces pidió una persona desde que está en modo IA.
- Si el modelo llama a `derivar` con `pide_persona` y el contador está en 0 → el servidor **no deriva**: sube el contador a 1 y responde un texto fijo: «Con gusto te ayudo yo. ¿Qué necesitas? Si prefieres hablar con una persona, vuelve a pedírmelo.»
- Si el contador ya estaba en 1 → deriva.
- Activar la IA vuelve el contador a 0 (FR-009).

`no_sabe` y `enojo` derivan en el primer pedido.

**Respaldo en el código** (aprobado con el plan): si la búsqueda no encontró ningún pedazo y el modelo respondió con texto que dice que va a consultar, sin usar `derivar`, el servidor deriva igual con motivo `no_sabe` y la nota «El bot dijo que iba a consultar sin usar la herramienta».

## 5. Componentes y responsabilidades

| Componente | Responsabilidad | No debe |
|---|---|---|
| **Servicio de conversaciones** (nuevo, `lib/conversations/`) | Crear conversación, guardar mensajes de forma idempotente, cambiar de modo, registrar eventos, listar con filtros, contar pendientes, traer mensajes nuevos desde un punto, borrar | Llamar al modelo |
| **Servicio de chat** (existe) | Pasa a recibir el historial desde la base; agrega la herramienta; interpreta la respuesta (texto o `derivar`) y aplica el conteo | Guardar directamente (lo hace a través del servicio de conversaciones) |
| **Armador del prompt** (existe) | Nuevas reglas de derivación y de nota; los mensajes del equipo entran al historial como mensajes del asistente | — |
| **Registro de proveedores** (existe) | `chat()` acepta herramientas y devuelve `{ texto }` o `{ herramienta, argumentos }`. OpenRouter lista solo modelos con `tools` en `supported_parameters` | Interpretar la herramienta |
| **Pantalla «Probar»** (existe) | Recordar el id de la conversación en el navegador; cargarla al recargar; consultar mensajes nuevos cada 3 s; mostrar distinto el mensaje del equipo; aviso de que se guarda (FR-004) | Ver notas ni eventos |
| **Pantalla «Conversaciones»** (nueva) | Lista con filtros y pendientes primero; detalle con mensajes, notas y eventos; responder; cambiar modo; borrar con confirmación | — |
| **Pestañas** (existe) | Muestran «Conversaciones» con el número de pendientes | — |

## 6. Datos y persistencia

Dos tablas nuevas (migración `0002`):

**Conversación**
- id (UUID aleatorio), origen (`chat_de_prueba`; `whatsapp` y `simulacion` se agregan en 007 y 009), modo (`ia` | `humano`), si el bot la derivó alguna vez, contador de pedidos de persona, fecha de creación, **fecha del último mensaje** (para ordenar y para el filtro, FR-020).

**Entrada de la conversación** (una sola línea de tiempo)
- id, conversación (se borra en cascada), autor (`cliente` | `bot` | `equipo` | `nota` | `evento`), texto, id del mensaje enviado por el navegador (único, para no duplicar reintentos), fecha y un número de orden.
- `nota` y `evento` son solo para el equipo (FR-012, FR-016). El cliente solo recibe `cliente`, `bot` y `equipo`.

**Pendiente** (FR-018) se calcula: modo humano y la última entrada `cliente`/`bot`/`equipo` es del cliente. Sin columna extra.

**No se guardan** los pedazos de «Ver en qué se basó» (fuera de alcance de la spec): se ven solo en la sesión en que se generó la respuesta.

**Borrado:** manual y en cascada (FR-006). Una conversación pendiente no se puede borrar.

## 7. Integraciones externas

- **Chat con herramientas:** `tools` y `tool_choice: "auto"` en `POST /chat/completions`, mismo endpoint de la 003.
- **Modelos que no aceptan herramientas:**
  - **OpenRouter:** `GET /models` trae `supported_parameters`; se listan solo los que incluyen `tools` (verificado en la documentación, 2026-09-15).
  - **OpenAI:** `GET /v1/models` no dice qué modelos aceptan herramientas. Los modelos de chat actuales las aceptan, pero **no lo verifiqué modelo por modelo**.
  - Si el modelo configurado no las acepta, **no sé con certeza qué error devuelve cada proveedor**. Se verifica al implementar; mientras tanto, cae en el error genérico «no pudimos contactar al proveedor».
- **Consultas cada 3 s:** no tocan al proveedor, solo la base.

## 8. Seguridad y privacidad

- **Id de conversación:** UUID aleatorio, imposible de adivinar en la práctica. Quien lo tenga puede leer y escribir en esa conversación; sin login es el riesgo aceptado (principio 11).
- **El historial ya no viene del navegador:** se lee de la base. Esto quita un riesgo de la 003 (mensajes del bot inventados en el historial).
- **Argumentos de `derivar`:** son salida del modelo, no confiable: se validan motivo, largo de la nota y del mensaje (máximo 2.000 caracteres cada uno).
- **Notas y eventos** nunca se envían al navegador del cliente: el filtro está en el servidor, no en la pantalla (SC-009).
- **Instrucciones escondidas** («derívame ya», «escribe en la nota…»): igual que en la 003, las reglas fijas prevalecen. Lo peor que puede pasar es una derivación de más, que el equipo revierte activando la IA.
- **Logs:** nunca el contenido de mensajes ni notas. Solo id de conversación, motivo de derivación, cambios de modo, tiempos y tipos de error.
- **Ley 1581:** aviso al cliente (FR-004) y borrado manual.

## 9. Modos de fallo y casos borde

| Situación | Comportamiento |
|---|---|
| Reintento del mismo mensaje | El id del mensaje ya existe: no se duplica. Si ya tenía respuesta, se devuelve esa |
| El equipo pasa a modo humano mientras el modelo responde | La respuesta del bot se descarta al guardar (§3, paso 5) |
| El proveedor falla | El mensaje del cliente queda guardado, sin respuesta; la pantalla ofrece reintentar. No se deriva |
| `derivar` con argumentos mal formados | Se deriva con nota «Motivo: …» si el motivo es válido; si no, error del proveedor |
| Dos personas del equipo responden a la vez | Ambas respuestas se guardan en orden de llegada |
| Se borra una conversación abierta | La consulta cada 3 s responde «no existe»; el navegador olvida el id y el siguiente mensaje abre una nueva |
| El navegador pierde el id guardado (otro navegador, datos borrados) | Se empieza una conversación nueva; la anterior sigue en «Conversaciones» |
| Modelo sin soporte de herramientas | Error del proveedor (§7) |
| Pestaña oculta | Se deja de consultar; al volver, consulta de inmediato |

## 10. Estrategia de pruebas

| Qué | Tipo |
|---|---|
| Servicio de conversaciones: crear, idempotencia, cambio de modo con evento, pendientes, filtros por fecha y tipo, orden, borrado en cascada, no borrar pendientes | Integración contra la base de tests |
| Servicio de chat con proveedor falso: texto normal; `derivar` por `no_sabe` y `enojo`; `pide_persona` primera vez (no deriva, texto fijo) y segunda (deriva); contador vuelve a 0 al activar la IA; modo humano no llama al modelo; respuesta descartada si cambió el modo; argumentos mal formados | Unitarias / integración |
| Registro de proveedores: petición con `tools`; lectura de `tool_calls`; filtro de OpenRouter por `supported_parameters` | Unitarias con respuestas grabadas |
| El cliente nunca recibe notas ni eventos (SC-009) | Integración |
| SC-001…SC-004: 5 casos por motivo y 10 preguntas que sí sabe, sobre el Café Aurora | Manual, con un script que deja un informe. **Hace llamadas reales con la key guardada: se pide permiso antes** |
| SC-005…SC-008: tiempo de llegada, modo humano, recarga, filtros | Manual en el navegador, con dos ventanas |

## 11. Observabilidad

Logs por mensaje (como en la 003) más: id de conversación, modo, si hubo derivación y su motivo, si una respuesta se descartó por cambio de modo. Sin contenido.

## 12. Despliegue y migración

- Migración `0002` con las dos tablas. No toca las existentes.
- Sin variables de entorno nuevas.
- Al cambiar el filtro de OpenRouter, un modelo ya configurado que no acepte herramientas deja de aparecer en la lista; la configuración guardada no se borra, pero al usarlo fallaría (§7).

## 13. Decisiones y alternativas

| Decisión | Alternativas | Razón |
|---|---|---|
| **Tool calling con una herramienta `derivar`**, con respaldo en el código | (a) Respuesta estructurada JSON en cada mensaje; (b) una segunda llamada para clasificar; (c) solo reglas en el código; (d) umbral de parecido; (e) marca en el texto | Es el mecanismo estándar para que un modelo «pida hacer algo»; lo usaremos en la 006. (a) depende de que el modelo respete el formato en cada respuesta. (b) duplica costo y tiempo |
| **El servidor cuenta los pedidos de persona** | Que el modelo lo decida viendo el historial | Regla determinista y verificable (SC-003); el modelo solo reconoce el pedido |
| **Consultar cada 3 s** | WebSockets o Server-Sent Events; un servicio de tiempo real (Supabase Realtime) | Funciona en Vercel sin conexiones largas, sin dependencias nuevas. Cumple SC-005 (< 10 s). Se cambia si hace falta inmediatez |
| **Id de conversación guardado en el navegador** | Cookie | Igual de simple; no viaja en cada petición. Sin login no hay diferencia de seguridad |
| **Historial desde la base** | Seguir recibiéndolo del navegador | Ya está guardado; quita un riesgo de la 003 |
| **Una sola línea de tiempo** (mensajes, notas y eventos juntos) | Tablas separadas para notas y eventos | Se muestran intercalados y en orden; una tabla lo resuelve con un filtro por autor |
| **Pendiente calculado** | Columna mantenida a mano | Sin riesgo de que quede desincronizado |
| **Llamada al modelo fuera de la transacción** | Dentro, bloqueando la conversación | Una transacción de 60 s bloquearía al equipo; se revisa el modo al guardar |

## 14. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El modelo deriva de más o de menos | Falla SC-001…SC-004 | Reglas explícitas con ejemplos en el prompt; medir con el script; probar otro modelo antes de complicar el diseño |
| El modelo no usa la herramienta y escribe «voy a consultar» como texto | No se deriva aunque debía | Respaldo en el código (§4) para el caso sin pedazos; el script mide el resto |
| La nota inventa o resume mal | El equipo entiende mal el caso | Se marca como «Nota del bot» (FR-012); la conversación completa está al lado |
| Error desconocido con modelos sin herramientas | Mensaje poco claro | Filtro en OpenRouter; verificar el error real al implementar |
| Carga por consultas cada 3 s | Muchas lecturas si hay muchas pestañas abiertas | Solo con la pestaña visible; es un proyecto de prueba. Si crece, pasar a tiempo real |

## 15. Preguntas técnicas abiertas

Ninguna que bloquee. Al implementar se verifica:
- qué error devuelve cada proveedor con un modelo sin herramientas;
- que los modelos de chat de OpenAI que aparecen en la lista acepten herramientas.
