# Plan técnico — 005 Aprendizaje desde respuestas humanas

- **Estado:** Approved (2026-09-15)
- **Fecha:** 2026-09-15
- **Spec:** `specs/005-aprendizaje-respuestas/spec.md` (Approved)

> Aprobado por delegación del usuario (2026-09-15), igual que la spec.

## 1. Contexto

Cuando el equipo devuelve una conversación al bot, lo que escribió esa persona es conocimiento que faltaba. Esta feature lo convierte en una **propuesta** de entrada para la base de conocimiento, que una persona revisa y aprueba. El bot nunca aprende solo (principio 8).

Restricciones que guían el diseño:
- **Reutilizar lo que ya existe:** las entradas de la 002 y su indexado; el tool calling de la 004.
- **No bloquear al equipo:** redactar la propuesta es una llamada al modelo; ocurre después de responder, no durante.
- **Principio 4:** la propuesta no debe llevar datos personales del cliente.

## 2. Estado actual

- **Base de conocimiento** (`lib/kb/service.ts`): `saveEntry({title, content})` crea la entrada y sus pedazos, que quedan pendientes de indexar; `indexPending()` los procesa, y las server actions lo lanzan con `after()`.
- **Conversaciones** (`lib/conversations/service.ts`): `setMode(id, "ia" | "humano")` cambia el modo y registra el evento; `getEntries(id, {forClient:false})` da la línea de tiempo completa.
- **Proveedores** (`lib/providers/`): `chat(mensajes, modelo, key, tools?)` devuelve texto o una llamada a herramienta.
- **Pantalla «Lo que sabe»** (`app/conocimiento/`): lista de entradas y documentos, con panel lateral para crear y editar.

## 3. Arquitectura propuesta

```
«Conversaciones»: el equipo activa la IA
   │ setModeAction(id, "ia")
   ▼
Servicio de conversaciones ── cambia el modo (respuesta inmediata)
   │ after(...)
   ▼
Servicio de aprendizaje ── ¿hubo respuestas del equipo?
   │ sí
   ▼
Registro de proveedores: chat(conversación, herramienta «proponer_conocimiento»)
   │
   ▼
Propuesta guardada (pendiente)
   │
   ▼
«Lo que sabe»: contador + revisión → aprobar (crea la entrada) o descartar
```

**Flujo:**
1. El equipo activa la IA. La acción cambia el modo y responde enseguida.
2. En segundo plano (`after`), el servicio de aprendizaje mira si la conversación tiene mensajes del equipo. Si no, termina.
3. Arma la conversación como texto y se la pasa al modelo con la herramienta `proponer_conocimiento(titulo, contenido)`.
4. Guarda la propuesta como pendiente. Si el proveedor falla, guarda el motivo para reintentar (FR-009).
5. «Lo que sabe» muestra las pendientes con su contador. Aprobar crea la entrada con `saveEntry()` y la marca como aprendida; descartar la elimina de la bandeja.

## 4. Componentes y responsabilidades

| Componente | Responsabilidad | No debe |
|---|---|---|
| **Servicio de aprendizaje** (nuevo, `lib/learning/`) | Decidir si hay algo que aprender, pedirle la redacción al modelo, guardar la propuesta, listar pendientes, aprobar (delegando en la base de conocimiento) y descartar | Escribir directamente en las tablas de la base de conocimiento |
| **Base de conocimiento** (existe) | `saveEntry()` gana la marca de «aprendida de una conversación» | Saber qué es una propuesta |
| **Conversaciones** (existe) | Nada nuevo: la acción de cambiar modo dispara el aprendizaje con `after()` | Llamar al modelo |
| **Pantalla «Lo que sabe»** (existe) | Sección «Por aprobar» con contador, revisión editable, aprobar y descartar | Redactar la propuesta |

## 5. Datos y persistencia

Migración `0003`:

**Propuesta de conocimiento** (`knowledge_proposals`)
- id, conversación (FK, se borra en cascada), título, contenido, estado (`pendiente` | `aprobada` | `descartada`), error (texto, para FR-009), fechas.
- Índice único parcial por conversación mientras el estado es `pendiente`: garantiza FR-003 en la base, no solo en el código.

**Entrada aprendida**
- `kb_entries` gana `learned_from_conversation_id` (FK con `on delete set null`): la entrada sobrevive al borrado de la conversación (FR-008).

## 6. Integraciones externas

**Redacción con el LLM.** Una llamada por conversación devuelta al bot, con la herramienta:

```json
{ "name": "proponer_conocimiento",
  "parameters": { "titulo": "string", "contenido": "string" } }
```

- El mensaje de sistema pide: redactar en tercera persona, como información de la empresa; **sin nombres, teléfonos ni direcciones del cliente**; título corto; contenido breve y autocontenido; y no inventar nada que no esté en la conversación.
- Si el modelo responde texto en vez de usar la herramienta, se descarta y se anota el error: es mejor no proponer que proponer basura.
- Timeout y errores: los mismos del registro de proveedores.

## 7. Seguridad y privacidad

- **Datos personales:** el prompt los prohíbe y la revisión humana es el control final (FR-002).
- **Salida del modelo no confiable:** título y contenido se recortan (200 y 4.000 caracteres) y se validan como texto no vacío.
- **Las propuestas nunca salen al cliente:** viven en pantallas del equipo; el chat no las consulta (FR-010).
- **Logs:** id de conversación y resultado, nunca el contenido.

## 8. Modos de fallo y casos borde

| Situación | Comportamiento |
|---|---|
| Conversación sin mensajes del equipo | No se propone nada |
| Ya hay una propuesta pendiente | No se crea otra (índice único parcial) |
| El proveedor falla | Se guarda el motivo; el equipo puede reintentar desde la conversación |
| El modelo responde texto sin usar la herramienta | Se trata como fallo: no se propone |
| Se borra la conversación | Las propuestas pendientes se borran con ella; las entradas aprobadas se conservan |
| Aprobar dos veces la misma propuesta | La segunda no hace nada: solo se aprueba si está pendiente |

## 9. Estrategia de pruebas

| Qué | Tipo |
|---|---|
| Servicio de aprendizaje: propone solo si hubo equipo, una pendiente por conversación, aprobar crea la entrada y la marca, descartar, fallo del proveedor anotado, argumentos inválidos | Integración contra la base de tests con proveedor falso |
| Migración: índice único parcial y `on delete set null` | Integración |
| Entrada aprendida sobrevive al borrado de la conversación | Integración |
| Pantalla: contador, revisión editable, aprobar, descartar | Manual en el navegador |
| SC-001…SC-005 | Manual, con conversaciones reales del Café Aurora |

## 10. Observabilidad

Log por propuesta: id de conversación, si se propuso o no y por qué; tiempo de la llamada. Sin contenido.

## 11. Despliegue y migración

Migración `0003`, sin variables de entorno nuevas. La columna nueva en `kb_entries` es opcional: las entradas existentes quedan sin marca.

## 12. Decisiones y alternativas

| Decisión | Alternativas | Razón |
|---|---|---|
| **Propuesta + aprobación humana** | Aprender automáticamente | El principio 8 no admite que el bot aprenda algo que nadie revisó |
| **Se dispara al activar la IA** | Un botón «aprender de esta conversación»; al responder cada mensaje | Activar la IA es la señal natural de «ya resolví»; un botón extra se olvida |
| **En segundo plano con `after()`** | Redactar antes de responder | El equipo no debe esperar una llamada al modelo para devolver la conversación |
| **Tool calling** | Pedir JSON en el texto | Mismo mecanismo que la derivación (004): una sola forma de pedirle datos al modelo |
| **Índice único parcial** | Comprobar en el código | La base garantiza FR-003 aunque haya dos llamadas a la vez |
| **Reusar `saveEntry()`** | Escribir la entrada desde el servicio nuevo | Las entradas ya se crean e indexan en un solo sitio |

## 13. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Propuestas pobres (respuestas cortas del equipo) | Trabajo de revisión para nada | Se descartan en un clic; si pasa mucho, exigir un mínimo de texto del equipo |
| El modelo cuela datos personales | Riesgo legal | Lo prohíbe el prompt y lo revisa una persona antes de guardar |
| Conocimiento contradictorio con lo ya cargado | El bot responde distinto según el pedazo que encuentre | Fuera de alcance detectar duplicados; se revisa a mano (anotado en la spec) |
| Gasto de saldo por cada devolución al bot | Coste | Solo una llamada por conversación con respuestas del equipo |

## 14. Preguntas técnicas abiertas

Ninguna que bloquee.
