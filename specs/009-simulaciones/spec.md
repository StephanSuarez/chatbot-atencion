# 009 — Simulaciones del chatbot

- **Estado:** Approved (2026-09-15)
- **Fecha:** 2026-09-15
- **Origen:** `roadmap.md`, feature 009

> Aprobada por delegación del usuario (2026-09-15). Las decisiones de producto van marcadas como *(decisión propia)*.

## Resumen

Hasta ahora, comprobar si el chatbot responde bien exige escribirle a mano una pregunta tras otra, o correr un script desde la terminal. Esta feature lleva eso a la plataforma: se guarda una lista de preguntas de prueba, se ejecutan todas de una vez contra el chatbot real, y queda un informe con lo que respondió y cuáles derivó.

Sirve para responder siempre la misma pregunta: **¿mi chatbot está listo?** Y para volver a preguntárselo cada vez que se cambia el prompt, el modelo o lo que sabe.

## Actores

- **Persona del equipo:** prepara las preguntas y lee los resultados. No hay login ni roles (principio 11).

## Historias de usuario

### HU-1 — Guardar una lista de preguntas de prueba (P1)

Como persona del equipo, quiero guardar las preguntas con las que quiero probar el bot, para no escribirlas cada vez.

- Dado que no hay ninguna prueba, cuando abro las simulaciones, entonces veo cómo crear la primera.
- Dado que escribo una pregunta y lo que espero que pase, cuando guardo, entonces queda en la lista.
- Dado que edito o elimino una pregunta, cuando confirmo, entonces la lista queda como la dejé.

### HU-2 — Correr la simulación (P1)

Como persona del equipo, quiero ejecutar todas las preguntas de una vez, para ver cómo se comporta el bot en conjunto.

- Dado que hay preguntas guardadas, cuando ejecuto la simulación, entonces el bot responde a todas y veo el avance mientras ocurre.
- Dado que la simulación termina, cuando la veo, entonces tengo cada pregunta con su respuesta y si el bot derivó o no.
- Dado que el proveedor falla en alguna pregunta, cuando termina, entonces esa queda marcada como fallida por el proveedor, sin contarse como error del bot.
- Dado que la configuración está incompleta, cuando intento ejecutar, entonces se me indica qué falta y no se gasta nada.

### HU-3 — Comparar con lo que esperaba (P1)

Como persona del equipo, quiero decir qué esperaba de cada pregunta, para ver de un vistazo qué salió mal.

- Dado que una pregunta espera «responde con lo que sabe», cuando el bot deriva, entonces se marca como no cumplida.
- Dado que una pregunta espera «deriva a una persona», cuando el bot responde sin derivar, entonces se marca como no cumplida.
- Dado que termina la simulación, cuando la veo, entonces tengo cuántas cumplieron de cuántas.

### HU-4 — No ensuciar las conversaciones reales (P2)

Como persona del equipo, quiero distinguir las simulaciones de las conversaciones de clientes, para que no me alteren las métricas ni las derivaciones.

- Dado que corro una simulación, cuando miro «Conversaciones», entonces sus conversaciones aparecen marcadas como «Simulación».
- Dado que una simulación deriva, cuando miro los pendientes, entonces esas conversaciones no aparecen como pendientes de responder.

## Requisitos funcionales

- **FR-001:** Se pueden crear, editar y eliminar preguntas de prueba, cada una con su texto y lo que se espera: «responde con lo que sabe», «deriva a una persona» o «sin expectativa».
- **FR-002:** Ejecutar una simulación envía cada pregunta al chatbot real, con su prompt, su modelo y lo que sabe.
- **FR-003:** Cada pregunta de la simulación ocurre en su propia conversación, sin historial compartido entre ellas. *(decisión propia)*
- **FR-004:** Las conversaciones de una simulación se guardan con origen «Simulación».
- **FR-005:** Las conversaciones de simulación **no cuentan como pendientes** de responder aunque deriven, y quedan en modo IA.
- **FR-006:** Mientras se ejecuta, se ve el avance (cuántas van de cuántas).
- **FR-007:** Al terminar, se guarda un informe con cada pregunta, su respuesta, si derivó y si cumplió lo esperado.
- **FR-008:** Se muestra el resultado global: cuántas cumplieron de cuántas.
- **FR-009:** Si el proveedor falla en una pregunta, se marca como fallida por el proveedor y no cuenta como incumplida.
- **FR-010:** Se conservan los informes anteriores, para comparar antes y después de un cambio.
- **FR-011:** Antes de ejecutar se avisa de que **consume saldo** de la API key configurada, indicando cuántas preguntas se van a enviar.
- **FR-012:** Con la configuración incompleta no se puede ejecutar.

## Casos borde

- **No hay preguntas guardadas:** no se puede ejecutar; se invita a crear la primera.
- **El proveedor corta por frecuencia:** cada pregunta que falle se marca; el resto continúa. *(decisión propia, aprendido con el modelo gratuito)*
- **Se cambia una pregunta después de una simulación:** los informes anteriores conservan el texto con el que se ejecutaron.
- **Se borra una pregunta:** los informes anteriores siguen mostrándola.
- **Dos simulaciones a la vez:** no se permite; se avisa de que ya hay una en curso. *(decisión propia)*
- **Se cierra la pestaña a mitad:** la simulación en curso queda marcada como interrumpida; lo ya respondido se conserva.

## Entidades clave

- **Pregunta de prueba:** un texto y lo que se espera que haga el bot.
- **Simulación:** una ejecución completa, con su fecha, su estado y su resultado global.
- **Resultado:** para cada pregunta, la respuesta del bot, si derivó, si cumplió y la conversación que generó.

## Criterios de éxito

- **SC-001:** Con 10 preguntas guardadas, ejecutar la simulación produce 10 resultados con sus respuestas.
- **SC-002:** Las expectativas se evalúan correctamente: una pregunta que espera derivación y deriva, cumple; si responde sin derivar, no cumple.
- **SC-003:** Las conversaciones de la simulación aparecen con origen «Simulación» y no cuentan como pendientes.
- **SC-004:** Un fallo del proveedor en una pregunta no invalida el resto de la simulación.
- **SC-005:** Los informes anteriores siguen consultables después de cambiar las preguntas.

## Restricciones externas

- **Proveedor de LLM:** cada pregunta consume saldo (búsqueda y respuesta). Los modelos gratuitos cortan por frecuencia, así que las preguntas se envían con una pausa entre ellas.
- **Ley 1581:** las preguntas de prueba las escribe el equipo; no deberían contener datos de clientes reales.

## Fuera de alcance

- Que otro modelo califique automáticamente si la respuesta es correcta. *(La expectativa es «derivó o no», que es objetiva.)*
- Simular conversaciones de varios turnos.
- Comparar dos informes lado a lado.
- Programar simulaciones automáticas.

## Preguntas abiertas

Ninguna.

## Diferido al plan

- Dónde se guardan las preguntas, las simulaciones y sus resultados.
- Cómo se ejecuta sin bloquear la pantalla y cómo se muestra el avance.
- Cómo se evita que las simulaciones ensucien pendientes y métricas.
