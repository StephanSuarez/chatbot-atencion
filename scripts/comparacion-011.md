# Convergencia de la 011 — Motor conversacional con LangGraph

- **Fecha:** 2026-09-22
- **Spec:** `specs/011-motor-langgraph/spec.md` · **Plan:** `specs/011-motor-langgraph/plan.md` · **Épica:** KAN-65
- **Cómo se corrió:** `npx tsx scripts/comparacion-011.mts antes` en `main` (motor viejo, commit `4774b7c`) y `npx tsx scripts/comparacion-011.mts despues` en la rama de KAN-69 (grafo conectado). Configuración local: OpenRouter, modelo `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, base de conocimiento del Café Aurora (6 entradas y 2 documentos), sin cuenta de Google. Resultados completos en `comparacion-011.antes.json` y `comparacion-011.despues.json`.

## SC-003 · Misma decisión con el modelo real

| # | Pregunta | Antes | Después |
|---|---|---|---|
| 1 | ¿A qué hora abren los sábados? | responde | responde |
| 2 | ¿Hacen domicilios? ¿Cuál es el pedido mínimo? | responde | responde |
| 3 | ¿Aceptan pago con Nequi? | responde | responde |
| 4 | ¿Tienen leche de almendras para el café? | responde | responde |
| 5 | Esto es un desastre, llevo una hora esperando… ¡Pésimo servicio! | deriva (enojo) | deriva (enojo) |
| 6 | Quiero hablar con una persona, por favor. | responde (ofrece ayudar; primer pedido) | responde (ofrece ayudar; primer pedido) |

**6 de 6 con la misma decisión.** La redacción varía entre corridas porque el modelo no es determinista (temperatura 0,2); la pregunta 6 devuelve el texto fijo del primer pedido de persona, idéntico en las dos. Las latencias no son comparables: el modelo gratuito corta por frecuencia y el guion reintenta con espera de 25 s (por eso hay preguntas de 80–90 s en la segunda corrida).

Los intentos cortados por el límite de tasa dejan hilos de checkpoints sin reanudar en la base de desarrollo (7 hilos, ninguno con respuesta del bot). Es el caso previsto en el plan §5: el guion reintenta con un id de mensaje nuevo en vez de reanudar el mismo, cosa que la interfaz sí hace.

## SC-001, SC-002, SC-004, SC-005 · Tests

| Criterio | Evidencia |
|---|---|
| SC-001 comportamiento idéntico | `lib/chat/service.test.ts`: 42 tests originales sin modificar, en verde tras conectar el grafo (KAN-69) |
| SC-002 conversaciones guionadas | La misma suite con proveedor simulado; `lib/graph/turno.test.ts` (17) comprueba además el recorrido nodo a nodo de cada camino |
| SC-004 reanudación sin repetir la búsqueda | `turno.test.ts` («un turno interrumpido en el modelo se reanuda…») y `service.test.ts` («un turno terminado no deja checkpoints…»): `findRelated` se llama una sola vez |
| SC-005 sin secretos en los checkpoints | `turno.test.ts` («ningún checkpoint contiene la API key») |
| Checkpointer | `lib/graph/checkpointer.test.ts` (9): ida y vuelta, escrituras pendientes, listado, borrado y un grafo real que falla y se reanuda sobre Postgres |

Suite completa al cerrar: 398 tests en 31 archivos; lint, typecheck y build en verde.

## Reglas de las specs 003, 004 y 006 → dónde viven en el grafo

| Regla | Dónde |
|---|---|
| 003 FR-004, FR-011 · validación del mensaje, configuración incompleta | `sendMessage`, antes del grafo |
| 003 FR-005, FR-009; 004 FR-013 · prompt con empresa, reglas fijas por encima de todo, información de la base | nodo `modelo` (`buildMessages`) |
| 003 FR-006 · busca en la base y responde solo con eso | nodos `buscar` (`findRelated`) y `modelo` |
| 003 FR-007; 004 FR-007 · no sabe → dice que consulta y deriva (herramienta `derivar` o respaldo por texto) | nodo `responder` (`derivationOf`) |
| 003 FR-008; 006 FR-005 · agendar no disponible sin cuenta u horario | nodo `preparar` (`canSchedule`) → `modelo` (herramientas y regla) |
| 003 FR-010 · «ver en qué se basó» | `sources` en el estado → `answer()` |
| 003 FR-012 · fallo del proveedor con motivo y modelo | nodos `buscar` y `modelo` etiquetan `ProviderError.model`; `sendMessage` traduce |
| 004 FR-001…003 · todo se guarda, con autor | `sendMessage` (mensaje del cliente) y nodo `guardar` (`saveBotTurn`) |
| 004 FR-008 · enojo claro | nodo `responder` (motivo `enojo`) |
| 004 FR-009 · segundo pedido de persona deriva; el primero ofrece ayudar | nodo `responder` (`personRequests`) |
| 004 FR-010…012 · mensaje al cliente, modo humano, nota y evento solo para el equipo | nodo `responder` → `guardar` (`toHuman`, `handoffReason`) |
| 004 FR-014, FR-015 · en modo humano el bot no responde; si el equipo toma la conversación a mitad de turno, la respuesta se descarta | `sendMessage` (antes del grafo) y nodo `guardar` (`saveBotTurn` devuelve `false`) |
| 006 FR-006 · solo horarios libres dentro del horario | nodo `disponibilidad` (`availability`) |
| 006 FR-007 · nombre y contacto antes de agendar | nodo `modelo` (`SCHEDULING_RULES`) y nodo `agendar` (`parseBooking` los exige) |
| 006 FR-008, FR-009 · crea el evento, confirma la hora exacta, no agenda ocupado ni fuera de horario | nodo `agendar` (`bookAppointment`, `REJECTED`) |
| 006 FR-010 · Google falla → no inventa la cita y deriva | nodo `agendar` (`toHuman` sin motivo del modelo) |
| 010 · adjuntos derivan sin llamar al modelo | `sendMessage`, antes del grafo |

Un turno recorre `preparar → buscar → modelo → (disponibilidad → modelo)? → agendar | responder → guardar`, con un checkpoint después de cada nodo, `thread_id` = id del mensaje del cliente, y borrado del hilo al terminar.

## Pendiente de decisión (no cambia en esta feature)

- Permitir más de una consulta de disponibilidad por turno: hoy la segunda se trata como respuesta inválida (comportamiento anterior, reproducido con `availabilityCalls`).
- Limpieza por antigüedad de hilos fallidos que nunca se reintentan (`ponytail:` en el plan §5).
