# 011 — Motor conversacional con LangGraph

- **Estado:** Approved (2026-09-22, autorizada por el usuario junto con el roadmap de la segunda iniciativa)
- **Fecha:** 2026-09-22
- **Origen:** `roadmap.md`, segunda iniciativa, feature 011
- **Tipo:** cambio técnico. No cambia el comportamiento del chatbot.

## Resumen

El turno del bot (lo que pasa desde que llega un mensaje del cliente hasta que se guarda la respuesta) hoy es una cadena de condicionales en un solo servicio. Esta feature lo reescribe como un **grafo de estados**: cada paso es un nodo, cada decisión es una arista, el estado del turno es un objeto tipado y, después de cada nodo, el estado queda guardado (checkpoint) en la base.

El objetivo es de aprendizaje: aplicar manejo de estado, nodos y aristas, y checkpointing sobre un chatbot que ya funciona, sin tocar lo que el cliente y el equipo perciben. Las specs 003 (chat), 004 (derivación) y 006 (agendamiento) siguen siendo la fuente de verdad del comportamiento.

## Actores

- **Cliente final y persona del equipo:** no notan ningún cambio.
- **Persona que desarrolla:** puede ver el turno como un grafo, inspeccionar el estado guardado de un turno que falló y reanudarlo.

## Historias de usuario

### HU-1 — El chatbot responde igual que antes (P1)

Como cliente, quiero que el bot me responda exactamente como lo hacía, para que el cambio interno no me afecte.

- Dado cualquier conversación de las specs 003, 004 y 006, cuando el cliente escribe, entonces el bot responde con el mismo texto, deriva por los mismos motivos y agenda con las mismas reglas que antes del cambio.
- Dado un mensaje reenviado (reintento), cuando llega por segunda vez, entonces sigue habiendo una sola respuesta.

### HU-2 — Un turno que falla a la mitad se reanuda donde quedó (P2)

Como persona que desarrolla, quiero que un turno interrumpido por un fallo del proveedor conserve lo que ya hizo, para que el reintento no repita trabajo ya hecho.

- Dado que el proveedor de LLM falló después de buscar en la base de conocimiento, cuando el cliente reintenta el mismo mensaje, entonces el bot retoma desde la llamada al modelo sin volver a buscar, y la respuesta es la misma que habría dado sin el fallo.

### HU-3 — El estado de un turno es legible (P3)

Como persona que desarrolla, quiero ver en qué paso quedó un turno y con qué estado, para entender y depurar el comportamiento del bot.

- Dado un turno que falló, cuando se consulta su estado por el id del mensaje, entonces se ve el último paso completado y los datos con los que iba a seguir.

## Requisitos funcionales

- **FR-001:** El turno del bot se ejecuta como un grafo con estado tipado, nodos y aristas condicionales. Lo que ocurre antes del turno (validación del mensaje, configuración, guardado del mensaje del cliente, modo humano, adjuntos) queda fuera del grafo.
- **FR-002:** El estado del turno se guarda después de cada nodo, en la base de datos del proyecto, identificado por el id del mensaje del cliente.
- **FR-003:** Un reintento de un mensaje cuyo turno falló reanuda el grafo desde el último nodo completado. Un reintento de un mensaje ya respondido devuelve la respuesta guardada, como hoy.
- **FR-004:** Al terminar un turno con éxito, su estado guardado se elimina: el registro duradero de la conversación sigue siendo el de la spec 004 (principio 4, minimización de datos).
- **FR-005:** Las credenciales (API key del LLM, permisos de Google) nunca forman parte del estado guardado (principio 3).
- **FR-006:** El comportamiento observable no cambia: mismos textos, mismos motivos de derivación, mismas reglas de agenda, mismos mensajes de error, misma respuesta a mensajes duplicados, mismo descarte de la respuesta si el equipo toma la conversación mientras el modelo responde.

## Casos borde

- **El proveedor falla en la búsqueda (embeddings) o en la respuesta (chat):** el mensaje de error nombra el modelo que falló, como hoy.
- **El primer intento muere antes de guardar ningún estado:** el reintento arranca el turno desde el principio.
- **El equipo toma la conversación mientras el grafo corre:** la respuesta se descarta, como hoy.
- **El modelo pide consultar disponibilidad dos veces en el mismo turno:** se comporta como hoy (la segunda se trata como respuesta inválida del proveedor). Cambiarlo es una decisión de producto que no toma esta feature.

## Entidades

- **Turno del bot:** el estado de un mensaje en curso: mensaje, historial, información encontrada, lo que pidió el modelo y lo que se va a guardar.
- **Checkpoint:** una foto del estado del turno después de un nodo, con su nodo siguiente.

## Criterios de éxito

- **SC-001:** La suite de tests existente pasa sin modificar ningún test de comportamiento (`lib/chat/service.test.ts` y el resto).
- **SC-002:** Un conjunto fijo de conversaciones guionadas (proveedor simulado) produce exactamente las mismas entradas guardadas antes y después del cambio.
- **SC-003:** Con el modelo real configurado en local, un conjunto de preguntas de prueba obtiene el mismo resultado (responde / deriva / agenda) antes y después. Se acepta variación en la redacción del modelo, no en la decisión.
- **SC-004:** Un turno interrumpido en la llamada al modelo se reanuda sin repetir la búsqueda (verificable en un test: la búsqueda se ejecuta una sola vez).
- **SC-005:** Ningún checkpoint contiene la API key ni el token de Google (verificable en un test que inspecciona lo guardado).

## Restricciones externas

- **LangGraph.js** requiere un identificador de hilo (`thread_id`) por ejecución cuando hay checkpoints, y que el estado sea serializable a JSON. Verificado en la versión 1.4 el 2026-09-22.
- **Vercel + Supabase:** la app corre sin estado entre peticiones y con el pooler en modo transacción; el guardado de checkpoints debe pasar por la misma conexión que el resto de la app.

## Fuera de alcance

- Cualquier cambio de comportamiento, incluida la aprobación humana antes de agendar (012) y permitir más de una consulta de disponibilidad por turno.
- Reemplazar el cliente HTTP de los proveedores o las herramientas por las de LangChain.
- MCP.

## Decisiones diferidas al plan

- Cómo se implementa el guardado de checkpoints (paquete oficial o propio).
- Qué va en el estado del grafo y qué sigue en las tablas de conversaciones.
- Cómo se identifica el hilo y cuándo se borra.
