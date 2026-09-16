# 006 — Agendamiento con Google

- **Estado:** Approved (2026-09-15)
- **Fecha:** 2026-09-15
- **Origen:** `roadmap.md`, feature 006

> Aprobada por delegación: el usuario autorizó el 2026-09-15 avanzar en las features 005 a 010 tomando yo las decisiones de producto, para revisarlas después. Van marcadas como *(decisión propia)*.

## Resumen

El chatbot deja de decir «por ahora no puedo agendar» y pasa a agendar citas de verdad en el calendario de Google de la empresa. La persona que configura conecta una cuenta de Google desde «Tu chatbot», define en qué horario se atiende y cuánto dura una cita, y el bot ofrece huecos libres, confirma los datos con el cliente y crea el evento.

Esto activa la segunda acción que el principio 10 le permite al bot: informar y **agendar citas**.

## Actores

- **Persona configuradora:** conecta la cuenta de Google y define el horario de atención. No hay login ni roles (principio 11).
- **Cliente:** pide una cita conversando con el bot.

## Historias de usuario

### HU-1 — Conectar el calendario (P1)

Como persona configuradora, quiero conectar la cuenta de Google de la empresa, para que el bot agende en su calendario.

- Dado que no hay cuenta conectada, cuando abro «Tu chatbot», entonces veo que el agendamiento está apagado y un botón para conectar Google.
- Dado que conecto la cuenta y autorizo el acceso al calendario, cuando vuelvo, entonces veo la cuenta conectada y en qué calendario se van a crear las citas.
- Dado que hay una cuenta conectada, cuando elijo desconectarla, entonces el bot deja de agendar y no se borra ninguna cita ya creada.
- Dado que Google rechaza o caduca el permiso, cuando el bot intenta agendar, entonces la plataforma avisa de que hay que volver a conectar la cuenta.

### HU-2 — Definir cuándo se puede agendar (P1)

Como persona configuradora, quiero decir en qué días y horas se atiende y cuánto dura una cita, para que el bot no ofrezca horarios imposibles.

- Dado que conecté Google, cuando configuro el agendamiento, entonces puedo elegir los días de la semana, la hora de inicio y fin, la duración de la cita y con cuánta anticipación mínima se puede pedir.
- Dado que guardo esa configuración, cuando un cliente pide una cita, entonces el bot solo ofrece horarios dentro de ella.
- Dado que no he configurado el horario, cuando un cliente pide una cita, entonces el bot dice que todavía no se pueden agendar citas.

### HU-3 — Agendar una cita conversando (P1)

Como cliente, quiero pedir una cita por el chat, para no tener que llamar.

- Dado que pido una cita, cuando el bot me responde, entonces me ofrece horarios libres dentro del horario de atención.
- Dado que elijo un horario, cuando el bot me lo pide, entonces me pregunta mi nombre y un dato de contacto antes de agendar.
- Dado que confirmo los datos, cuando el bot agenda, entonces me dice la fecha y la hora exactas de la cita creada.
- Dado que el horario que pedí ya está ocupado, cuando el bot revisa, entonces me lo dice y me ofrece otros.
- Dado que pido una cita fuera del horario de atención o con menos anticipación de la permitida, cuando el bot responde, entonces me explica cuándo sí se puede.

### HU-4 — Que un fallo no deje al cliente colgado (P2)

Como cliente, quiero que alguien me atienda si el agendamiento falla, para no quedarme sin cita.

- Dado que Google no responde o rechaza la petición, cuando el bot intenta agendar, entonces me dice que no pudo, no inventa una cita y pasa la conversación a una persona (004).

## Requisitos funcionales

### Conectar y configurar

- **FR-001:** «Tu chatbot» permite conectar una cuenta de Google autorizando el acceso a su calendario, y muestra cuál está conectada.
- **FR-002:** El permiso de Google se guarda cifrado, igual que la API key, y nunca se muestra completo.
- **FR-003:** Se puede desconectar la cuenta en cualquier momento; las citas ya creadas no se tocan.
- **FR-004:** Se configuran: días de atención, hora de inicio y fin, duración de la cita y anticipación mínima.
- **FR-005:** Sin cuenta conectada o sin horario configurado, el bot no agenda y lo dice cuando se lo piden.

### Agendar

- **FR-006:** El bot solo ofrece horarios libres en el calendario conectado, dentro del horario configurado y respetando la anticipación mínima.
- **FR-007:** Antes de agendar, el bot pide y confirma el nombre del cliente y un dato de contacto.
- **FR-008:** Al agendar, se crea un evento en el calendario con la fecha, la hora, la duración configurada, el nombre del cliente y el motivo, y el bot confirma al cliente la fecha y la hora creadas.
- **FR-009:** El bot no agenda dos citas a la misma hora ni fuera del horario configurado.
- **FR-010:** Si Google falla o el permiso caducó, el bot lo dice sin inventar una cita y deriva a una persona (004).
- **FR-011:** Del cliente solo se guardan el nombre y el contacto que él mismo da, y solo dentro del evento y de la conversación (principio 4).
- **FR-012:** Cancelar o reprogramar una cita no lo hace el bot: lo hace una persona desde el calendario.

## Casos borde

- **El cliente pide «mañana a las 3» y ese hueco está ocupado:** el bot ofrece los más cercanos disponibles.
- **El cliente pide una fecha pasada o un día no atendido:** el bot explica el horario y ofrece alternativas.
- **El cliente no da su nombre o se arrepiente:** no se agenda nada.
- **El cliente pide dos citas en la misma conversación:** se agendan las dos si hay huecos. *(decisión propia)*
- **El permiso de Google caducó o fue revocado:** el bot no agenda, avisa, la plataforma marca la cuenta como desconectada y se deriva a una persona.
- **Dos clientes piden el mismo hueco a la vez:** solo uno lo obtiene; al otro se le ofrecen alternativas.
- **La empresa tiene varios calendarios:** se agenda en el principal de la cuenta conectada. *(decisión propia)*
- **Zona horaria:** las citas se crean en la zona horaria del calendario conectado. *(decisión propia)*

## Entidades clave

- **Cuenta de Google conectada:** el permiso guardado y el calendario donde se crean las citas.
- **Configuración de agendamiento:** días, horas, duración y anticipación mínima.
- **Cita:** un evento en el calendario, con su fecha, hora, cliente y motivo.

## Criterios de éxito

- **SC-001:** Con la cuenta conectada y el horario configurado, de 5 pedidos de cita dentro del horario, en al menos 4 el bot crea el evento con la fecha y hora que confirmó al cliente.
- **SC-002:** De 5 pedidos fuera del horario o sin la anticipación mínima, en los 5 el bot explica cuándo sí se puede y no crea nada.
- **SC-003:** El bot nunca crea dos citas en el mismo hueco.
- **SC-004:** Sin cuenta conectada, el bot dice que no puede agendar y no falla.
- **SC-005:** Con el permiso revocado, el bot avisa, no inventa la cita y deriva a una persona.

## Restricciones externas

- **Google Calendar API** (verificado en la documentación oficial el 2026-09-15): los eventos se crean con `POST https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events`, con `start` y `end` como fecha y hora con zona horaria. Los permisos posibles incluyen `https://www.googleapis.com/auth/calendar` y `https://www.googleapis.com/auth/calendar.events`; se pide el mínimo necesario (principio 3).
- **OAuth de Google** (verificado el 2026-09-15): el consentimiento se pide en `https://accounts.google.com/o/oauth2/v2/auth` y el intercambio ocurre en `https://oauth2.googleapis.com/token`; para obtener un permiso duradero hay que pedir `access_type=offline`.
- **Credenciales de Google:** el proyecto en Google Cloud, su pantalla de consentimiento y las credenciales las crea el dueño de la cuenta. Sin eso, la feature no se puede probar de punta a punta.
- **Ley 1581 de 2012:** el nombre y el contacto del cliente quedan en el evento del calendario y en la conversación; se le informa de para qué se usan.

## Fuera de alcance

- Cancelar o reprogramar citas desde el bot (FR-012).
- Recordatorios automáticos al cliente.
- Varios calendarios, varias sedes o varias personas que atienden.
- Pagos o señas para reservar.
- Sincronizar citas creadas fuera del bot (más allá de respetar los huecos ocupados).

## Preguntas abiertas

Ninguna: las decisiones de producto las tomé yo por delegación y están marcadas.

## Diferido al plan

- Cómo se guarda y se renueva el permiso de Google.
- Cómo consulta el bot los huecos libres.
- Cómo se le dice al modelo que agende (herramienta) y cómo se valida lo que responde.
- Qué pasa si el evento se crea pero la respuesta se pierde.
