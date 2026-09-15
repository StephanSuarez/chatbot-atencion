# 004 — Derivación a humano

- **Estado:** Approved (2026-09-15)
- **Fecha:** 2026-09-15
- **Origen:** `roadmap.md`, feature 004

## Resumen

El bot pasa la conversación a una persona del equipo cuando no puede resolverla: no tiene la información, el cliente está enojado o pide hablar con una persona de forma reiterada (constitución, principio 9). Al derivar, deja una nota interna explicando qué pasó. La persona del equipo ve la conversación en la plataforma y le responde al cliente en esa misma conversación.

Cada conversación está en **modo IA** (responde el bot) o en **modo humano** (responde el equipo). El bot la pasa a modo humano al derivar, y el equipo puede cambiar el modo de cualquier conversación cuando quiera.

Para que esto funcione, y para poder auditar lo que hace el bot, **todas las conversaciones se guardan**, con su origen. Esto reemplaza la regla de la 003 de no guardar conversaciones (003, FR-003).

## Actores

- **Cliente:** quien conversa con el bot. En esta feature, cualquier persona que escribe en la pestaña «Probar».
- **Persona del equipo:** quien revisa las conversaciones y responde en modo humano. No hay login ni roles (principio 11): es cualquier persona que entra a la plataforma.

## Historias de usuario

### HU-1 — Que el bot derive cuando no puede resolver (P1)

Como cliente, quiero que una persona me atienda cuando el bot no puede ayudarme, para no quedarme sin respuesta.

- Dado que pregunto algo que no está en lo que sabe el bot, cuando responde, entonces dice que no tiene esa información y que va a consultar, y la conversación pasa a modo humano.
- Dado que escribo un mensaje claramente enojado (insultos, quejas fuertes), cuando el bot responde, entonces reconoce mi molestia, dice que una persona va a continuar la conversación, y la conversación pasa a modo humano.
- Dado que pido hablar con una persona por primera vez, cuando el bot responde, entonces ofrece ayudarme él mismo y no deriva.
- Dado que ya pedí hablar con una persona y lo vuelvo a pedir, cuando el bot responde, entonces dice que una persona va a continuar la conversación, y la conversación pasa a modo humano.
- Dado que hago una pregunta que el bot sí sabe responder, cuando responde, entonces no deriva.

### HU-2 — Entender por qué derivó el bot (P1)

Como persona del equipo, quiero que el bot me explique por qué derivó, para entender el caso sin leer toda la conversación y saber qué le falta aprender.

- Dado que el bot derivó por no saber, cuando abro la conversación, entonces veo una nota del bot con lo que preguntó el cliente y qué información no encontró.
- Dado que el bot derivó por enojo o por pedido de una persona, cuando abro la conversación, entonces veo una nota del bot con el motivo y un resumen de lo que pasó.
- Dado que hay una nota del bot, cuando el cliente ve su chat, entonces no la ve.

### HU-3 — Atender en modo humano (P1)

Como persona del equipo, quiero responder yo mismo en cualquier conversación, para atender a los clientes que el bot no pudo ayudar o corregirlo cuando responde mal.

- Dado que hay conversaciones pendientes (en modo humano, con el último mensaje del cliente sin responder), cuando entro a la plataforma, entonces la pestaña «Conversaciones» muestra cuántas hay.
- Dado que abro una conversación, cuando la leo, entonces veo todos sus mensajes y notas desde el principio, en orden, y en qué modo está.
- Dado que una conversación está en modo IA, cuando la paso a modo humano, entonces el bot deja de responder en ella.
- Dado que una conversación está en modo humano, cuando escribo una respuesta y la envío, entonces le llega al cliente en esa misma conversación.
- Dado que el cliente escribe mientras tengo la conversación abierta, cuando llega su mensaje, entonces lo veo sin recargar.
- Dado que una conversación está en modo humano, cuando activo la IA, entonces el siguiente mensaje del cliente lo responde el bot.

### HU-4 — Esperar a la persona sin que el bot interfiera (P1)

Como cliente, quiero saber que me va a atender una persona y que el bot no me conteste mientras tanto, para no recibir respuestas cruzadas.

- Dado que el bot derivó la conversación, cuando la veo, entonces me dijo que una persona del equipo va a continuar la conversación.
- Dado que la conversación está en modo humano, cuando escribo más mensajes, entonces el bot no responde y mis mensajes le llegan al equipo.
- Dado que una persona del equipo me responde, cuando tengo el chat abierto, entonces veo su respuesta en pocos segundos sin recargar la página, y se distingue que la escribió una persona y no el bot.
- Dado que recargo la página, cuando vuelvo a «Probar», entonces sigo en la misma conversación, con sus mensajes.

### HU-5 — Revisar todas las conversaciones (P2)

Como persona del equipo, quiero ver y filtrar todas las conversaciones que ha tenido el bot, para revisar cómo está atendiendo.

- Dado que hay conversaciones guardadas, cuando abro «Conversaciones», entonces las veo todas, las pendientes primero y el resto de la más reciente a la más antigua, cada una con su origen, su modo y si el bot la derivó.
- Dado que filtro por un rango de fechas, cuando aplico el filtro, entonces solo veo las conversaciones de ese rango.
- Dado que filtro por «Derivadas por el bot» o «Sin derivar», cuando aplico el filtro, entonces solo veo esas.
- Dado que elijo borrar una conversación que no está pendiente, cuando confirmo, entonces desaparece; si cancelo, no cambia nada.

## Requisitos funcionales

### Guardar conversaciones

- **FR-001:** Toda conversación del bot se guarda desde el primer mensaje, con todos sus mensajes en orden. Reemplaza 003, FR-003.
- **FR-002:** Cada conversación guarda su origen. En esta feature el único origen es «Chat de prueba». WhatsApp (007) y Simulación (009) se agregan en sus features.
- **FR-003:** Cada mensaje guardado indica quién lo escribió: el cliente, el bot o una persona del equipo.
- **FR-004:** Al empezar una conversación, el cliente ve el aviso «Esta conversación se guarda para mejorar la atención» (Ley 1581).
- **FR-005:** Recargar la página mantiene la conversación actual. «Nueva conversación» empieza otra; la anterior queda guardada.
- **FR-006:** Las conversaciones no se borran solas. Una persona del equipo puede borrar cualquier conversación que no esté pendiente, con confirmación.

### Derivar

- **FR-007:** El bot deriva cuando no tiene la información para responder, en el mismo mensaje en que dice que va a consultar (principio 8).
- **FR-008:** El bot deriva cuando el cliente muestra enojo claro. Una queja leve o un desacuerdo no es enojo claro.
- **FR-009:** El bot deriva cuando el cliente pide hablar con una persona por segunda vez desde que la conversación está en modo IA. La primera vez ofrece ayudar él mismo.
- **FR-010:** Al derivar, el bot le dice al cliente que una persona del equipo va a continuar la conversación y la pasa a modo humano.
- **FR-011:** Al derivar, el bot deja una nota interna con el motivo (no sabe, enojo o pedido de una persona) y qué pasó. Si derivó por no saber, la nota dice qué preguntó el cliente y qué información no encontró.
- **FR-012:** Las notas del bot solo las ve el equipo, marcadas como «Nota del bot». El cliente nunca las ve.
- **FR-013:** Estas reglas se cumplen aunque el prompt de comportamiento pida lo contrario (principio 10).

### Modo IA y modo humano

- **FR-014:** Toda conversación está en modo IA o en modo humano. Empieza en modo IA.
- **FR-015:** En modo humano el bot no responde. Los mensajes del cliente se guardan y le llegan al equipo.
- **FR-016:** Una persona del equipo puede pasar cualquier conversación a modo humano, y activar la IA en cualquier conversación en modo humano. Cada cambio de modo queda registrado en la conversación, visible solo para el equipo.
- **FR-017:** Una persona del equipo puede responder en cualquier conversación en modo humano. Su respuesta aparece en el chat del cliente en pocos segundos, sin recargar, identificada como escrita por una persona del equipo.
- **FR-018:** Una conversación está pendiente cuando está en modo humano y el último mensaje es del cliente. La pestaña «Conversaciones», junto a las demás, indica cuántas hay pendientes.

### Lista de conversaciones

- **FR-019:** «Conversaciones» muestra todas las conversaciones: las pendientes primero y el resto de la más reciente a la más antigua. Cada una muestra su origen, su modo, si el bot la derivó y la fecha.
- **FR-020:** La lista se puede filtrar por rango de fechas y por tipo: todas, derivadas por el bot o sin derivar. El filtro de fechas usa la fecha del último mensaje de la conversación.

## Casos borde

- **El cliente pide una persona dos veces en el mismo mensaje:** cuenta como un solo pedido; el segundo tiene que venir en otro mensaje. *(supuesto)*
- **Se activa la IA y el cliente vuelve a pedir una persona:** el conteo de pedidos empieza de cero al activar la IA (FR-009).
- **Se activa la IA con mensajes del cliente sin responder:** el bot no responde esos mensajes; responde a partir del siguiente. *(supuesto)*
- **Una persona del equipo pasa a modo humano una conversación que el bot no derivó:** el cliente no recibe aviso; simplemente las siguientes respuestas son del equipo. *(supuesto)*
- **El cliente escribe justo mientras el equipo pasa la conversación a modo humano:** el bot no responde a ningún mensaje que llegue después del cambio.
- **Dos personas del equipo responden la misma conversación a la vez:** las dos respuestas llegan al cliente, en el orden en que se enviaron. No hay asignación (fuera de alcance).
- **El cliente cierra el chat antes de que respondan:** la respuesta queda guardada; si vuelve a abrir «Probar» en el mismo navegador, la ve.
- **El cliente elige «Nueva conversación» mientras espera a una persona:** la conversación anterior sigue pendiente para el equipo; el cliente ya no ve lo que le respondan ahí.
- **Nadie responde nunca:** la conversación sigue pendiente; no hay tiempo límite ni mensaje automático.
- **El proveedor de LLM falla antes de que el bot responda:** el mensaje del cliente queda guardado una sola vez; reintentar no lo duplica. La conversación no se deriva por el fallo.
- **La nota del bot no se puede generar** (por ejemplo, falla el proveedor justo después de derivar): la conversación igual pasa a modo humano, con una nota que indica solo el motivo. *(supuesto)*
- **La persona del equipo intenta enviar una respuesta vacía:** no se envía.
- **Se borra una conversación que un cliente tiene abierta:** el siguiente mensaje del cliente empieza una conversación nueva.
- **La base de conocimiento está vacía:** el bot deriva en todo lo que no sea un saludo, por no saber (FR-007).
- **El rango de fechas no tiene conversaciones:** la lista indica que no hay conversaciones en ese rango, distinto de cuando no hay ninguna.

## Entidades clave

- **Conversación:** los mensajes y notas entre un cliente, el bot y el equipo. Tiene un origen, un modo y una fecha.
- **Origen:** de dónde viene la conversación: Chat de prueba (hoy), WhatsApp (007), Simulación (009).
- **Modo:** IA (responde el bot) o humano (responde el equipo).
- **Mensaje:** texto escrito por el cliente, el bot o una persona del equipo, con su orden. Visible para el cliente y el equipo.
- **Nota del bot:** explicación interna de por qué derivó. Visible solo para el equipo.
- **Cambio de modo:** registro de cuándo la conversación pasó a modo humano o a modo IA, y si lo hizo el bot o el equipo. Visible solo para el equipo.

## Criterios de éxito

- **SC-001:** De 5 preguntas cuya respuesta no está en lo que sabe el bot, deriva en al menos 4, y cada derivación tiene una nota que dice qué preguntó el cliente y qué no encontró.
- **SC-002:** De 5 mensajes con enojo claro, deriva en al menos 4.
- **SC-003:** De 5 conversaciones donde el cliente pide una persona dos veces, deriva en al menos 4, y en ninguna deriva al primer pedido.
- **SC-004:** De 10 preguntas cuya respuesta sí está en lo que sabe el bot, no deriva en ninguna.
- **SC-005:** Con una conversación en modo humano abierta en «Probar», la respuesta de la persona del equipo aparece en menos de 10 segundos, sin recargar.
- **SC-006:** En modo humano el bot no responde ningún mensaje del cliente; al activar la IA, el siguiente mensaje lo responde el bot.
- **SC-007:** Toda conversación del chat de prueba aparece en «Conversaciones» con origen «Chat de prueba», y recargar la página no la pierde.
- **SC-008:** Los filtros por fecha y por tipo muestran solo las conversaciones que corresponden.
- **SC-009:** Ninguna nota del bot ni cambio de modo aparece en el chat del cliente.

## Restricciones externas

- **Ley 1581 de 2012 (Habeas Data):** las conversaciones pueden contener datos personales del cliente. Se le informa que la conversación se guarda (FR-004). El borrado es manual; cuando haya clientes reales (007) debe definirse un plazo de conservación.
- **Proveedor de LLM:** decidir si derivar y escribir la nota depende del modelo, que no responde siempre igual y puede equivocarse; por eso los criterios se miden sobre varios casos y las notas se marcan como del bot. Cada mensaje sigue consumiendo saldo de la API key (principio 11).
- **Principio 10:** el aviso al equipo es solo dentro de la plataforma; no hay correo ni notificaciones externas.

## Fuera de alcance

- Audios, imágenes y documentos en el chat (010).
- Métricas de conversaciones: resueltas por el bot frente a derivadas, preguntas frecuentes (008).
- Simulaciones del chatbot (009).
- Que el bot aprenda de las respuestas del equipo o de sus notas (005).
- WhatsApp (007) y agendamiento (006).
- Asignar conversaciones entre varias personas del equipo, o saber quién respondió.
- Horarios de atención, tiempos límite o mensajes automáticos cuando nadie responde.
- Borrado automático de conversaciones.
- Notas del bot en situaciones que no sean una derivación.
- Guardar «Ver en qué se basó» de cada respuesta.

## Preguntas abiertas

Ninguna.

## Diferido al plan

- Cómo decide el bot que no sabe, que el cliente está enojado o que pidió una persona, y cómo escribe la nota.
- Cómo le llegan al cliente y al equipo los mensajes nuevos sin recargar.
- Cómo se reconoce la conversación de un cliente al recargar la página.
- Cómo se evita duplicar un mensaje al reintentar.
