# Plan técnico — 011 Motor conversacional con LangGraph

- **Estado:** Approved (2026-09-22)
- **Spec:** `specs/011-motor-langgraph/spec.md`

## 1. Contexto

El turno del bot vive en `lib/chat/service.ts` (`sendMessage`): una función de ~150 líneas que prepara el contexto, busca en la base de conocimiento, llama al modelo con herramientas y, según lo que el modelo pida, consulta disponibilidad y vuelve a llamar, agenda, deriva a humano o responde; al final guarda el turno con `saveBotTurn`. Es un grafo escrito con `if`.

Esta feature lo expresa como un grafo de LangGraph (`@langchain/langgraph` 1.4) sin cambiar lo que hace. Restricciones que mandan: principio 3 (secretos fuera del estado guardado), principio 4 (minimización de datos), spec 011 FR-006 (comportamiento idéntico) y la regla de la iniciativa (tests y simulaciones como arnés de regresión).

## 2. Estado actual

Verificado en el código el 2026-09-22:

- `sendMessage` mezcla dos cosas: lo previo al turno (validación, configuración, guardado del mensaje del cliente, modo humano, reintento, adjuntos) y el turno en sí. Solo el turno es un grafo.
- Los proveedores se llaman por HTTP propio (`lib/providers/http.ts`); las herramientas son definiciones JSON a mano (`lib/chat/derivar.ts`, `lib/chat/agendar.ts`) y sus argumentos se validan en el servidor.
- El reintento de un mensaje se resuelve por `clientMessageId` (único) antes de llamar al modelo.
- `failingModel` es una variable mutable que recuerda si el fallo vino de embeddings o de chat, para nombrar el modelo en el mensaje de error.
- No hay ningún SDK de IA instalado; `zod` tampoco.
- Deuda que afecta a esta feature: ninguna.

## 3. Arquitectura propuesta

```
sendMessage (lib/chat/service.ts)
  validación · configuración · saveClientMessage · modo humano · reintento · adjunto
        │
        ▼
  turno del bot = grafo (lib/graph/turno.ts)            checkpoint tras cada nodo
                                                          (lib/graph/checkpointer.ts → Postgres)
  START ──► preparar ──► buscar ──► modelo ──┬─ ver_disponibilidad (1ª vez) ──► disponibilidad ──► modelo
                                            ├─ agendar_cita ──► agendar ──► guardar ──► END
                                            └─ texto / derivar / 2ª disponibilidad ──► responder ──► guardar ──► END
        │
        ▼
  answer(): lee las entradas nuevas y el modo desde la base (como hoy)
```

Flujo de un mensaje:

1. `sendMessage` hace todo lo previo exactamente como hoy.
2. Ejecuta el grafo con `thread_id = clientMessageId` y el proveedor y la API key como **contexto de ejecución** (`context`), no como estado.
3. Si ya existe un checkpoint para ese hilo con un nodo pendiente (el turno falló antes), reanuda con `invoke(null)`; si no, arranca con el estado inicial.
4. Al terminar con éxito borra el hilo de la tabla de checkpoints (FR-004) y responde con `answer()` como hoy.
5. Si un nodo lanza `ProviderError`, el error llega intacto a `sendMessage`, que lo traduce al mensaje de usuario como hoy; el checkpoint del nodo anterior queda para el reintento.

## 4. Componentes y responsabilidades

| Componente | Responsabilidad | No debe |
|---|---|---|
| **`lib/chat/service.ts`** (`sendMessage`) | Lo previo al turno; decidir arrancar o reanudar el grafo; borrar el hilo al terminar; traducir errores del proveedor | Contener lógica del turno |
| **`lib/graph/turno.ts`** | Definir el estado (`Annotation`), los nodos, las aristas y compilar el grafo con el checkpointer | Hablar HTTP, validar argumentos (eso sigue en `derivar.ts` y `agendar.ts`), guardar credenciales en el estado |
| **`lib/graph/checkpointer.ts`** (`DbSaver`) | Implementar `BaseCheckpointSaver` sobre Drizzle: guardar, leer, listar y borrar checkpoints y escrituras pendientes | Saber qué hay dentro de un checkpoint |
| **`lib/schema.ts`** | Dos tablas nuevas: `graph_checkpoints` y `graph_checkpoint_writes` | — |
| **`lib/providers/http.ts`** (`ProviderError`) | Campo opcional `model`: qué modelo falló. Lo etiqueta el nodo que hizo la llamada | — |

Nodos del grafo (nombres en español, como las herramientas):

| Nodo | Hace | Escribe en el estado |
|---|---|---|
| `preparar` | `indexPending`, cuenta pendientes, `canSchedule`, historial reciente | `pendingInfo`, `canSchedule`, `history`, `startedAt` |
| `buscar` | `findRelated` con `retrievalQuery` | `sources` |
| `modelo` | Arma `messages` si es la primera llamada; `provider.chat` con las herramientas según `canSchedule` | `messages`, `result`, `modelCalls` |
| `disponibilidad` | `availability(día)`; añade el mensaje de sistema con los horarios | `messages`, `availabilityCalls` |
| `agendar` | `parseBooking` + `bookAppointment`; decide confirmación, rechazo o derivación por fallo de Google | `turn` |
| `responder` | `derivationOf` (herramienta derivar o respaldo por texto) y la regla del primer pedido de persona | `turn` |
| `guardar` | `saveBotTurn(conversationId, turn)`; log del turno | — |

Aristas condicionales: tras `modelo`, según `result`: `ver_disponibilidad` y `availabilityCalls === 0` → `disponibilidad`; `agendar_cita` → `agendar`; cualquier otra cosa → `responder`. El contador reproduce el comportamiento actual (una segunda consulta se trata como respuesta inválida); con el grafo, permitir más consultas es cambiar una condición, y queda como decisión de producto pendiente.

## 5. Datos y persistencia

**Estado del grafo** (todo serializable a JSON): `conversationId`, `seq`, `message`, `companyName`, `prompt`, `model`, `personRequests`, `pendingInfo`, `canSchedule`, `history`, `sources`, `messages`, `result`, `modelCalls`, `availabilityCalls`, `turn`, `startedAt`. Sin reducers acumulativos: cada nodo reemplaza lo que escribe. **Nunca:** el objeto proveedor ni la API key; van en `context` (verificado el 2026-09-22 que `configurable` y `context` no se persisten en el checkpoint ni en sus metadatos).

**Dueño de la verdad:** `conversations` y `conversation_entries` siguen siendo el registro del producto. Los checkpoints guardan solo el estado **dentro de un turno** y se borran al terminar; solo sobreviven los de turnos fallidos, hasta que el reintento los complete.

**Tablas nuevas:**

- `graph_checkpoints`: `thread_id`, `checkpoint_ns`, `checkpoint_id`, `parent_checkpoint_id`, `type`, `checkpoint` (bytea), `metadata` (bytea), `created_at`. PK `(thread_id, checkpoint_ns, checkpoint_id)`.
- `graph_checkpoint_writes`: `thread_id`, `checkpoint_ns`, `checkpoint_id`, `task_id`, `idx`, `channel`, `type`, `value` (bytea). PK `(thread_id, checkpoint_ns, checkpoint_id, task_id, idx)`.

Con RLS como el resto (`0008_rls`). Los bytes salen del serializador del propio LangGraph (`serde.dumpsTyped`), que devuelve tipo + bytes; se guardan tal cual y se leen con `loadsTyped`. Migración generada con `drizzle-kit`, aplicada por el build de Vercel como las anteriores; es aditiva (dos tablas nuevas), así que un solo despliegue.

**Volumen:** un turno deja ~7 checkpoints con el prompt completo (chunks + historial) dentro; por eso se borran al terminar. Los de turnos fallidos que nunca se reintentan quedan; `ponytail:` sin limpieza programada, se agrega un borrado por antigüedad si la tabla crece.

## 6. Integraciones externas

Ninguna nueva. El grafo llama a los mismos módulos (`findRelated`, `provider.chat`, `availability`, `bookAppointment`, `saveBotTurn`) que hoy, por los mismos caminos.

## 7. Seguridad y privacidad

- Credenciales fuera del estado (FR-005), con un test que serializa todos los checkpoints de un turno y comprueba que la API key no aparece.
- El id de hilo es el `clientMessageId` que genera el navegador. Ya se valida como texto en `sendMessage`; el checkpointer no lo usa como clave de objeto en memoria (es una columna), así que no aplica el riesgo de contaminación de prototipo que mitiga `MemorySaver`.
- Los checkpoints contienen contenido de la conversación (prompt, historial). Se borran al terminar el turno (principio 4).
- No se registra el estado en logs.

## 8. Modos de fallo

| Situación | Comportamiento |
|---|---|
| Proveedor falla en `buscar` | `ProviderError` con `model = text-embedding-3-small`; mensaje como hoy; queda el checkpoint de `preparar` |
| Proveedor falla en `modelo` | `ProviderError` con `model = modelo de chat`; queda el checkpoint de `buscar`; el reintento reanuda sin volver a buscar |
| Reintento de un turno fallido | `getState` muestra nodo pendiente → `invoke(null)` |
| Reintento de un turno ya respondido | Se devuelve lo guardado antes de tocar el grafo (como hoy) |
| El equipo toma la conversación durante el turno | `saveBotTurn` devuelve `false`; la respuesta se descarta (como hoy) |
| Falla el guardado del checkpoint | El turno falla con ese error (no es `ProviderError`): no se esconde, como hoy con cualquier error que no sea del proveedor |
| Argumentos inválidos de una herramienta | Como hoy: `ProviderError unavailable` (derivar) o rechazo (agendar) |

## 9. Estrategia de pruebas

| Qué | Cómo |
|---|---|
| SC-001 comportamiento idéntico | `lib/chat/service.test.ts` sin cambios y verde. Es el golden: 40 casos que cubren respuesta, derivación, reintentos, modo humano, errores, agenda y adjuntos |
| SC-002 conversaciones guionadas | Cubierto por la misma suite con proveedor simulado; se agrega en `lib/graph/turno.test.ts` el recorrido nodo a nodo (qué nodo escribió qué) |
| SC-004 reanudación | Test con `MemorySaver`: el modelo falla una vez; el segundo `invoke(null)` responde y `findRelated` se llamó una sola vez |
| SC-005 sin secretos | Test que recorre los checkpoints del hilo y busca la API key en su serialización |
| Checkpointer | `lib/graph/checkpointer.test.ts` contra la base de tests: ida y vuelta, orden, `parentConfig`, escrituras pendientes, borrado; y un grafo real que falla y se reanuda sobre Postgres |
| SC-003 modelo real | Script con las mismas preguntas antes (`main`) y después (rama), con la configuración local (OpenRouter, modelo gratuito). Se compara la decisión, no la redacción |
| Lint, typecheck, build | Los del proyecto |

## 10. Observabilidad

El log por turno de hoy (`[chat] proveedor modelo conv=… pedazos … ms`) se mantiene desde `guardar`, con `startedAt` del estado. Sin métricas nuevas.

## 11. Despliegue

Una migración aditiva (dos tablas). Vercel la aplica en el build de producción; la versión anterior sigue corriendo con las tablas de más, sin conflicto. Sin variables de entorno nuevas. Rollback: revertir el PR; las tablas pueden quedar.

## 12. Decisiones y alternativas

| Decisión | Alternativas | Motivo |
|---|---|---|
| Grafo solo para el turno del bot; lo previo sigue en `sendMessage` | Meter todo `sendMessage` en el grafo | Lo previo no tiene decisiones ni llamadas caras: en el grafo serían nodos sin valor y el reintento se complicaría |
| Checkpointer propio sobre Drizzle (`DbSaver`) | `PostgresSaver` oficial (`@langchain/langgraph-checkpoint-postgres`) | El oficial trae un segundo cliente (`pg`) y crea sus tablas fuera de las migraciones; con el pooler de Supabase habría dos formas de conectarse. El propio son ~120 líneas sobre la conexión existente, con migraciones normales, y es el objetivo de aprendizaje |
| `thread_id = clientMessageId` (un hilo por turno) | Un hilo por conversación | El historial ya vive en `conversation_entries`; un hilo por conversación duplicaría la memoria y acumularía estado sin límite. Por turno, el reintento y el futuro `interrupt` (012) caen en el mismo hilo |
| Borrar el hilo al terminar | Conservar los checkpoints | Principio 4: contienen prompt e historial que ya están guardados de otra forma |
| Proveedor y API key en `context`, no en el estado | `configurable`; cerrar sobre variables al compilar | `context` es el mecanismo de LangGraph 1.x para contexto de ejecución; verificado que no se persiste |
| Se conservan `provider.chat`, los parsers y las definiciones de herramientas | Modelos y tools de LangChain | Cambia el motor, no el borde con el proveedor; el diff queda acotado y la validación de argumentos ya existe |
| `ProviderError.model` etiquetado por el nodo que llamó | Mantener `failingModel` mutable | El grafo no puede compartir una variable mutable con `sendMessage`; el nodo sabe qué modelo usó |
| Contador `availabilityCalls` | Permitir varias consultas por turno | Reproducir el comportamiento actual (FR-006); relajarlo es decisión de producto |
| Versiones fijadas: `@langchain/langgraph` 1.4.17, `@langchain/core`, `zod` 4 | Rangos | Primer SDK de IA del proyecto y ecosistema que cambia rápido |

## 13. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Latencia: ~7 escrituras de checkpoint por turno contra Supabase | Decenas de ms por nodo; el turno ya tarda segundos por el LLM | Medir con el log de turno; si pesa, fusionar nodos (`preparar`+`buscar`) |
| Reanudar con estado viejo si cambió la configuración entre el fallo y el reintento | Respuesta con el prompt anterior | Aceptado: el reintento es inmediato en la práctica; se documenta |
| Errores de serialización del estado | Turno falla | Estado solo con tipos JSON; test de ida y vuelta |
| Cambios de API entre versiones de LangGraph | Rotura en actualización | Versiones fijadas; el checkpointer se apoya solo en la clase base pública |

## 14. Preguntas técnicas abiertas

Ninguna que bloquee. Verificado el 2026-09-22 con la versión instalada: reanudación con `invoke(null)` tras un fallo, `context` fuera del checkpoint, y que el error original del nodo llega intacto al llamador.
