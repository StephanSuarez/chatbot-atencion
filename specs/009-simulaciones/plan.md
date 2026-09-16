# Plan técnico — 009 Simulaciones del chatbot

- **Estado:** Approved (2026-09-15)
- **Fecha:** 2026-09-15
- **Spec:** `specs/009-simulaciones/spec.md` (Approved)

> Aprobado por delegación del usuario (2026-09-15).

## 1. Contexto

Llevar a la plataforma lo que hoy son los scripts `scripts/evaluacion-004.mts` y `scripts/validacion-005.mts`: una lista de preguntas, una ejecución contra el chatbot real y un informe.

La lección de esos scripts manda en el diseño: **el proveedor falla a menudo** (el modelo gratuito corta por frecuencia), así que el fallo del proveedor tiene que distinguirse del fallo del bot, y una pregunta caída no puede tumbar la simulación.

## 2. Estado actual

- **Servicio de chat** (`lib/chat/service.ts`): `sendMessage({ conversationId?, clientMessageId, message })` crea la conversación, responde y puede derivar. Devuelve el modo resultante.
- **Conversaciones** (004): tienen `origin`, hoy solo `chat_de_prueba`, y `pending` se calcula como «modo humano y último mensaje del cliente».
- **Métricas** (008): cuentan todas las conversaciones del periodo.

## 3. Arquitectura propuesta

```
Pestaña «Probar» → sección «Simulaciones»
   │ crear/editar preguntas (server actions)
   │ ejecutar
   ▼
Servicio de simulaciones ── crea la simulación (en_curso)
   │  para cada pregunta, con pausa entre ellas:
   │     sendMessage(origen simulación) → respuesta + ¿derivó?
   │     guarda el resultado y avanza el contador
   ▼
Informe: cumplidas / total, y el detalle por pregunta
```

**Ejecución sin bloquear la pantalla:** la acción de ejecutar crea la simulación y lanza el trabajo con `after()`. La pantalla consulta el avance cada 2 s, igual que el resto del proyecto. Así una simulación de 10 preguntas no depende de que la pestaña siga abierta.

**Una conversación por pregunta** (FR-003): se llama a `sendMessage` sin `conversationId`, así cada pregunta arranca limpia.

## 4. Componentes y responsabilidades

| Componente | Responsabilidad | No debe |
|---|---|---|
| **Servicio de simulaciones** (nuevo, `lib/simulations/`) | Preguntas (crear, editar, borrar), ejecutar, guardar resultados, evaluar expectativas y listar informes | Hablar con el proveedor directamente |
| **Servicio de chat** (existe) | Recibe un origen para la conversación que crea | Saber qué es una simulación |
| **Conversaciones** (existe) | Nuevo origen `simulacion`; las de simulación nunca cuentan como pendientes | — |
| **Pantalla «Probar»** (existe) | Sección de simulaciones: preguntas, botón de ejecutar con su aviso de gasto, avance e informes | Ejecutar nada por su cuenta |

## 5. Datos y persistencia

Migración `0006`:

- **`simulation_questions`**: texto y expectativa (`responde`, `deriva`, `ninguna`), con su fecha.
- **`simulations`**: fecha, estado (`en_curso`, `terminada`, `interrumpida`), total de preguntas y cuántas van.
- **`simulation_results`**: simulación, **texto de la pregunta copiado** (FR-010: el informe no cambia si luego se edita o borra la pregunta), expectativa, respuesta, si derivó, si cumplió, error del proveedor y la conversación generada (con `on delete set null`).
- **`conversations.origin`** acepta `simulacion` (el check se amplía).

## 6. Integraciones externas

Ninguna nueva: se usa el servicio de chat, que ya habla con el proveedor. Entre preguntas se espera un intervalo configurable en el código (por defecto 3 s), por lo aprendido con el modelo gratuito.

## 7. Seguridad y privacidad

- Las preguntas las escribe el equipo; no se piden datos de clientes.
- Ejecutar gasta saldo: se avisa antes con el número de preguntas (FR-011) y se bloquea si la configuración está incompleta (FR-012).
- Sin login (principio 11): cualquiera con acceso puede ejecutar, igual que puede usar el chat.

## 8. Modos de fallo y casos borde

| Situación | Comportamiento |
|---|---|
| El proveedor falla en una pregunta | Se guarda el error en ese resultado y se sigue con la siguiente (FR-009) |
| Ya hay una simulación en curso | No se empieza otra; se avisa |
| Sin preguntas | No se puede ejecutar |
| Se corta el proceso a mitad | La simulación queda `en_curso`; al entrar de nuevo, una en curso sin avance durante más de 10 minutos se muestra como interrumpida |
| Se edita o borra una pregunta | Los informes conservan el texto con el que se ejecutaron |

## 9. Estrategia de pruebas

| Qué | Tipo |
|---|---|
| Preguntas: crear, editar, borrar, validaciones | Integración |
| Ejecución con chat falso: resultados guardados, avance, expectativas evaluadas, fallo del proveedor que no tumba el resto | Integración |
| Origen `simulacion` y que no cuenten como pendientes | Integración |
| Informes anteriores intactos tras editar o borrar preguntas | Integración |
| Pantalla y SC-001…SC-005 | Manual, **gasta saldo**: se pide permiso |

## 10. Observabilidad

Log por simulación: id, cuántas preguntas, cuántas fallaron por el proveedor y duración. Sin el contenido de las respuestas.

## 11. Despliegue y migración

Migración `0006`. Sin variables nuevas.

## 12. Decisiones y alternativas

| Decisión | Alternativas | Razón |
|---|---|---|
| **Una conversación por pregunta** | Todas en la misma conversación | Cada pregunta se juzga sola; con historial compartido, la segunda dependería de la primera |
| **Expectativa objetiva (derivó o no)** | Que otro modelo califique la respuesta | Calificar con un modelo cuesta dinero y es opinable; «derivó o no» es un hecho |
| **Ejecutar con `after()` y consultar el avance** | Hacerlo en la petición | Diez preguntas con pausas tardan más de lo que aguanta una petición |
| **Copiar el texto de la pregunta en el resultado** | Referencia a la pregunta | Un informe tiene que seguir siendo legible después de editar o borrar la pregunta |
| **Las simulaciones no cuentan como pendientes** | Tratarlas como conversaciones normales | Nadie tiene que responderle a una simulación (FR-005) |

## 13. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El proveedor corta y casi todo falla | Informe inútil | Cada fallo se marca aparte; el resultado global dice cuántas fueron fallos del proveedor |
| Las simulaciones inflan las métricas | Números engañosos | Las métricas podrán filtrarse por origen; queda anotado para la 008 si molesta |
| Ejecuciones largas | El usuario no sabe si avanza | Contador de avance y estado visible |

## 14. Preguntas técnicas abiertas

Ninguna.
