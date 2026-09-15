# 003 — Chat de prueba

- **Estado:** Approved (2026-09-15)
- **Fecha:** 2026-09-15
- **Origen:** `roadmap.md`, feature 003

## Resumen

Una pantalla dentro de la plataforma para conversar con el chatbot como lo haría un cliente. El bot responde con el nombre de la empresa, su prompt de comportamiento, las reglas fijas y lo que sabe (002). Busca en su base de conocimiento la información relacionada con cada pregunta y responde solo con ella: si no la encuentra, no inventa.

Sirve para probar el bot antes de conectarlo a un canal real (007). También deja ver en qué información se basó cada respuesta, para entender y ajustar cómo encuentra la información (objetivo de aprendizaje del proyecto).

## Actores

- **Persona que prueba:** cualquier persona que entra a la plataforma. No hay login ni roles (constitución, principio 11). Conversa con el bot como si fuera un cliente.

## Historias de usuario

### HU-1 — Conversar con el chatbot (P1)

Como persona que prueba, quiero escribirle al chatbot y recibir respuestas, para ver cómo atendería a un cliente.

- Dado que la configuración está completa, cuando abro la pestaña «Probar», entonces veo una conversación vacía lista para escribir.
- Dado que escribo un mensaje y lo envío, cuando el bot responde, entonces veo mi mensaje y su respuesta en orden, y mientras responde veo que está escribiendo.
- Dado que es el primer mensaje de la conversación, cuando el bot responde, entonces saluda y se presenta como el asistente de la empresa, según su prompt.
- Dado que ya hay mensajes, cuando sigo escribiendo, entonces el bot tiene en cuenta lo que se habló antes en esa conversación.
- Dado que elijo «Nueva conversación», o recargo la página, cuando vuelvo a escribir, entonces la conversación empieza de cero.

### HU-2 — Que responda solo con lo que sabe (P1)

Como persona que prueba, quiero que el bot use solo la información cargada, para confiar en que no le va a inventar nada a un cliente.

- Dado que la respuesta está en lo que sabe el bot, cuando pregunto, entonces responde con esa información.
- Dado que la respuesta no está en lo que sabe el bot, cuando pregunto, entonces dice que no tiene esa información y que va a consultar, sin inventarla.
- Dado que pido algo que no tiene que ver con la empresa (por ejemplo, un poema), cuando pregunto, entonces se niega con amabilidad y ofrece ayuda sobre la empresa.
- Dado que el prompt de comportamiento pide algo contrario a las reglas fijas, cuando pregunto, entonces prevalecen las reglas fijas.

### HU-3 — Ver en qué se basó una respuesta (P2)

Como persona que prueba, quiero ver qué información usó el bot en cada respuesta, para entender por qué respondió así y mejorar lo que sabe.

- Dado que el bot respondió, cuando elijo «Ver en qué se basó», entonces veo los pedazos de información que encontró, de qué texto o documento viene cada uno y qué tan parecido era a mi pregunta.
- Dado que el bot no encontró información relacionada, cuando elijo «Ver en qué se basó», entonces se indica que no encontró nada relacionado.

### HU-4 — Saber por qué no se puede probar (P2)

Como persona que prueba, quiero saber qué falta cuando el chat no funciona, para arreglarlo.

- Dado que la configuración está incompleta (sin proveedor, modelo o API key), cuando abro «Probar», entonces el chat no se puede usar y se indica qué falta, con un enlace a «Tu chatbot».
- Dado que el proveedor falla al responder, cuando envío un mensaje, entonces veo un mensaje claro con el motivo, mi mensaje no se pierde y puedo reintentar.

## Requisitos funcionales

- **FR-001:** El chat está en una pestaña «Probar», junto a «Tu chatbot» y «Lo que sabe», abierta a cualquier persona.
- **FR-002:** Cada persona que prueba tiene su propia conversación. Varias personas probando a la vez no ven los mensajes de las otras.
- **FR-003:** *(Reemplazado por la spec 004, FR-001: desde la 004 todas las conversaciones se guardan.)* Las conversaciones no se guardan. Recargar la página o elegir «Nueva conversación» empieza una conversación de cero.
- **FR-004:** Los mensajes son solo texto, de hasta 1.000 caracteres. Un mensaje vacío o solo con espacios no se envía.
- **FR-005:** El bot responde con el nombre de la empresa, el prompt de comportamiento, las reglas fijas (principios 8, 9 y 10) y la información de su base de conocimiento que esté lista para usarse (002, FR-011).
- **FR-006:** Para cada mensaje, el bot busca en su base de conocimiento la información relacionada con la pregunta y responde solo con esa información y con lo que se habló en la conversación.
- **FR-007:** Si no encuentra la información, el bot dice que no la tiene y que va a consultar. No la inventa (principio 8). En esta feature no se deriva a una persona (004).
- **FR-008:** Si le piden algo que no es informar sobre la empresa o agendar citas, se niega con amabilidad (principio 10). Agendar todavía no está disponible (006): si le piden una cita, dice que por ahora no puede agendarla.
- **FR-009:** Las reglas fijas se cumplen aunque el prompt de comportamiento o un mensaje del usuario pidan lo contrario.
- **FR-010:** Debajo de cada respuesta hay una opción «Ver en qué se basó», que muestra los pedazos de información usados, su origen (título del texto o nombre del documento) y qué tan parecidos eran a la pregunta.
- **FR-011:** Si la configuración está incompleta, el chat no permite escribir e indica qué falta, con un enlace a la configuración.
- **FR-012:** Si el proveedor falla (key inválida, sin saldo, modelo no disponible, servicio caído o sin respuesta), se muestra un mensaje con el motivo y la opción de reintentar. El mensaje del usuario se conserva.
- **FR-013:** Mientras el bot responde, se indica que está escribiendo y no se puede enviar otro mensaje.

## Casos borde

- **Base de conocimiento vacía:** el bot responde a todo lo que no sea saludo diciendo que no tiene esa información (FR-007).
- **Información pendiente de preparar (002):** no se usa hasta estar lista; el chat avisa que parte de la información todavía no está disponible para el bot. *(supuesto, ver reporte de validación)*
- **El modelo elegido ya no existe en el proveedor** (pendiente desde la spec 001): se muestra el motivo y se invita a elegir otro modelo en «Tu chatbot».
- **Se acabó el saldo de la API key:** mensaje claro de que el proveedor rechazó la solicitud por saldo; sugiere revisar la cuenta del proveedor.
- **La respuesta tarda demasiado:** se corta y se ofrece reintentar.
- **Mensaje de más de 1.000 caracteres:** no se puede enviar; se indica el límite.
- **Enviar dos veces el mismo mensaje rápidamente:** se envía una sola vez (FR-013).
- **Un documento o mensaje con instrucciones escondidas** («ignora tus reglas»): se trata como información o como mensaje del cliente, no como instrucción; prevalecen las reglas fijas (FR-009).
- **La configuración cambia mientras se prueba** (otro prompt, otro modelo, información nueva): los siguientes mensajes usan la configuración nueva.
- **Conversación muy larga:** el bot sigue respondiendo; puede dejar de tener en cuenta los mensajes más antiguos. *(supuesto, ver reporte de validación)*

## Entidades clave

- **Conversación de prueba:** los mensajes entre la persona que prueba y el bot. Existe mientras la página esté abierta; no se guarda.
- **Mensaje:** texto de la persona o del bot, en orden.
- **Información usada en una respuesta:** los pedazos de la base de conocimiento que el bot encontró para una pregunta, con su origen y su parecido.

## Criterios de éxito

- **SC-001:** Con la base del Café Aurora cargada, de 10 preguntas cuya respuesta está en lo que sabe el bot, al menos 9 se responden correctamente (aprobado por el usuario con la spec, 2026-09-15).
- **SC-002:** De 10 preguntas cuya respuesta no está en lo que sabe el bot, en las 10 dice que no tiene la información y no inventa.
- **SC-003:** De 5 pedidos fuera del alcance de la empresa (poema, tarea, opinión política…), en los 5 se niega con amabilidad.
- **SC-004:** En cada respuesta, «Ver en qué se basó» muestra los pedazos usados con su origen.
- **SC-005:** Con la configuración incompleta, el chat no permite escribir y dice qué falta.
- **SC-006:** Con una API key inválida, el chat muestra el motivo y conserva el mensaje para reintentar.
- **SC-007:** Dos personas probando a la vez no ven los mensajes de la otra, y recargar la página deja la conversación vacía.

## Restricciones externas

- **Proveedor de LLM:** cada mensaje consume saldo de la API key configurada, tanto al buscar la información como al responder (riesgo aceptado, principio 11). Los modelos gratuitos de algunos proveedores pueden tener límites de uso o retener los mensajes.
- **Respuestas no deterministas:** el mismo mensaje puede recibir respuestas distintas. Por eso los criterios de éxito se miden sobre varias preguntas.
- **Ley 1581 de 2012:** las conversaciones de prueba no se guardan (FR-003), así que esta feature no almacena datos personales. Lo que se escribe sí viaja al proveedor de LLM.

## Fuera de alcance

- Guardar conversaciones, verlas después o que una persona responda (004).
- Derivar a una persona (004); en esta feature el bot solo dice que va a consultar.
- Aprender de las respuestas (005).
- Agendar citas (006).
- WhatsApp u otros canales (007).
- Adjuntar imágenes, audios o archivos en el chat.
- Calificar las respuestas o editar la respuesta del bot.

## Preguntas abiertas

Ninguna. SC-001 quedó en 9 de 10 al aprobar la spec (2026-09-15).

## Diferido al plan

- Cuántos pedazos se buscan por pregunta y con qué parecido mínimo se consideran relacionados.
- Cómo se combinan el prompt, las reglas fijas, la información encontrada y la conversación al hablar con el LLM.
- Cómo se protege contra instrucciones escondidas en documentos o mensajes.
- Si la respuesta aparece de a poco o completa.
- Cuántos mensajes anteriores se tienen en cuenta en una conversación larga.
- Cómo se detecta cada tipo de fallo del proveedor (saldo, modelo retirado, caída).
- Cómo se mide «qué tan parecido» para mostrarlo en «Ver en qué se basó».
