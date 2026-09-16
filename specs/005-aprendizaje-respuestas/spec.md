# 005 — Aprendizaje desde respuestas humanas

- **Estado:** Approved (2026-09-15)
- **Fecha:** 2026-09-15
- **Origen:** `roadmap.md`, feature 005

> Aprobada por delegación: el usuario autorizó el 2026-09-15 avanzar en las features 005 a 010 tomando yo las decisiones de producto, para revisarlas después. Las decisiones que normalmente se preguntarían están marcadas como *(decisión propia)*.

## Resumen

Cuando una persona del equipo responde una conversación derivada, esa respuesta es conocimiento que el bot no tenía. Esta feature lo aprovecha: al devolver la conversación al bot, la plataforma **propone** una entrada para la base de conocimiento, redactada a partir de lo que preguntó el cliente y lo que respondió el equipo.

Nada se aprende solo. La propuesta se revisa, se edita si hace falta y se aprueba; solo entonces entra en «Lo que sabe» y el bot la usa. Así el bot aprende sin romper el principio 8 (no inventa) ni el 4 (minimización de datos).

## Actores

- **Persona del equipo:** la misma que atiende las derivaciones. Revisa y aprueba lo que el bot va a aprender. No hay login ni roles (principio 11).

## Historias de usuario

### HU-1 — Que la plataforma proponga lo aprendido (P1)

Como persona del equipo, quiero que la plataforma me proponga qué aprender de una conversación que acabo de atender, para no tener que redactarlo yo desde cero.

- Dado que respondí una conversación en modo humano, cuando activo la IA, entonces la plataforma prepara una propuesta con un título y un contenido basados en lo que se habló.
- Dado que la propuesta está lista, cuando abro «Lo que sabe», entonces la veo pendiente de revisión, con un contador.
- Dado que la conversación no tiene ninguna respuesta del equipo, cuando activo la IA, entonces no se propone nada.

### HU-2 — Revisar antes de que el bot lo aprenda (P1)

Como persona del equipo, quiero revisar y corregir la propuesta antes de guardarla, para que el bot no aprenda algo mal escrito o con datos de un cliente.

- Dado que abro una propuesta, cuando la reviso, entonces veo el título y el contenido propuestos, y la conversación de la que salen.
- Dado que edito el título o el contenido, cuando apruebo, entonces se guarda lo que yo dejé escrito, no lo que propuso la plataforma.
- Dado que apruebo una propuesta, cuando vuelvo a «Lo que sabe», entonces la entrada aparece en la lista como cualquier otra y el bot la usa al responder.
- Dado que descarto una propuesta, cuando vuelvo a la lista, entonces desaparece y no se vuelve a proponer por esa conversación.

### HU-3 — Saber qué aprendió el bot y de dónde (P2)

Como persona del equipo, quiero distinguir lo que el bot aprendió de una conversación de lo que escribí yo, para revisar su calidad.

- Dado que una entrada vino de una conversación, cuando la veo en «Lo que sabe», entonces está marcada como aprendida y puedo abrir la conversación de origen.
- Dado que borro esa conversación, cuando veo la entrada, entonces sigue existiendo, y el enlace indica que la conversación ya no está.

## Requisitos funcionales

- **FR-001:** Al pasar una conversación de modo humano a modo IA, si hubo al menos un mensaje del equipo, la plataforma prepara una propuesta de conocimiento.
- **FR-002:** La propuesta contiene un título y un contenido redactados a partir de la pregunta del cliente y las respuestas del equipo, en tercera persona y sin datos personales del cliente.
- **FR-003:** Una conversación genera como máximo una propuesta pendiente a la vez.
- **FR-004:** Las propuestas pendientes se revisan en «Lo que sabe», con un contador visible.
- **FR-005:** Al revisar, se puede editar el título y el contenido antes de aprobar.
- **FR-006:** Aprobar crea una entrada de la base de conocimiento (002) con ese título y contenido, la deja pendiente de indexar como cualquier entrada nueva, y la marca como aprendida de una conversación.
- **FR-007:** Descartar elimina la propuesta y esa conversación no vuelve a proponer nada.
- **FR-008:** Una entrada aprendida indica de qué conversación salió y permite abrirla mientras exista.
- **FR-009:** Si la propuesta no se puede redactar (falla el proveedor), la conversación queda anotada para reintentarlo y el equipo puede pedirlo de nuevo desde la conversación.
- **FR-010:** Las propuestas no son visibles para el cliente en ningún caso.

## Casos borde

- **La conversación solo tiene mensajes del bot y del cliente:** no se propone nada (FR-001).
- **El equipo activa la IA y vuelve a modo humano varias veces:** solo hay una propuesta pendiente por conversación (FR-003); al aprobar o descartar, una nueva ronda de respuestas puede generar otra.
- **La respuesta del equipo es un saludo o una despedida** («ya te ayudo», «con gusto»): la propuesta saldrá pobre; para eso está la revisión humana, que puede descartarla. *(decisión propia)*
- **El contenido propuesto trae datos del cliente** (nombre, teléfono, dirección): la persona los borra antes de aprobar; el texto propuesto ya pide no incluirlos (FR-002).
- **Se borra la conversación de origen:** la entrada aprobada se conserva; el enlace indica que la conversación ya no está (FR-008).
- **El proveedor falla al redactar:** no se pierde nada, queda anotado y se puede reintentar (FR-009).
- **Se aprueba una propuesta con un título que ya existe:** se crea igual, como cualquier entrada repetida de la 002. *(decisión propia)*

## Entidades clave

- **Propuesta de conocimiento:** título y contenido sugeridos para una conversación, con su estado (pendiente, aprobada, descartada).
- **Entrada aprendida:** una entrada normal de la base de conocimiento que además recuerda de qué conversación salió.

## Criterios de éxito

- **SC-001:** De 5 conversaciones atendidas por el equipo, en las 5 se prepara una propuesta al activar la IA.
- **SC-002:** De esas 5 propuestas, al menos 4 se pueden aprobar con pocos o ningún cambio, a juicio de quien revisa.
- **SC-003:** Una propuesta aprobada aparece en «Lo que sabe» y el bot la usa para responder esa misma pregunta en una conversación nueva.
- **SC-004:** Descartar una propuesta la elimina y no se vuelve a proponer por esa conversación.
- **SC-005:** Ninguna propuesta llega al cliente.

## Restricciones externas

- **Proveedor de LLM:** redactar la propuesta es una llamada más al modelo y consume saldo de la API key configurada (principio 11).
- **Ley 1581 de 2012:** el conocimiento aprendido no debe contener datos personales del cliente; la redacción los evita y la revisión humana es el control final.

## Fuera de alcance

- Que el bot aprenda sin revisión humana.
- Aprender de documentos externos o de fuentes que no sean conversaciones.
- Detectar y fusionar entradas que digan lo mismo.
- Medir la calidad de lo aprendido (eso es 008).
- Aprender de conversaciones que el bot atendió solo.

## Preguntas abiertas

Ninguna. Las decisiones de producto las tomé yo por delegación del usuario y están marcadas como *(decisión propia)*.

## Diferido al plan

- Cómo se le pide al modelo que redacte el título y el contenido.
- Dónde se guardan las propuestas y cómo se relacionan con la conversación y con la entrada creada.
- Si la redacción ocurre al instante o después de responder.
