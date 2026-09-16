# 010 — Mensajes multimedia

- **Estado:** Approved (2026-09-15)
- **Fecha:** 2026-09-15
- **Origen:** `roadmap.md`, feature 010

> Aprobada por delegación del usuario (2026-09-15). Las decisiones de producto van marcadas como *(decisión propia)*.

## Resumen

Hoy una conversación solo admite texto. Por WhatsApp (007) los clientes mandan audios, fotos y documentos constantemente: una foto del producto que llegó roto, un audio explicando un problema, el PDF de una factura. Si la conversación no puede recibirlos, la persona del equipo se queda sin la mitad de lo que el cliente quiso decir.

Esta feature permite que **el cliente y la persona del equipo** adjunten audios, imágenes y documentos a sus mensajes, y que ambos vean lo que el otro envió, dentro de la misma conversación que ya existe.

El bot **no** interpreta esos archivos. Cuando un cliente le manda uno en modo IA, el bot no adivina qué contiene: dice que lo va a revisar una persona y deriva. *(decisión propia; ver «Decisiones» y «Fuera de alcance»)*

## Actores

- **Cliente:** envía audios, imágenes y documentos en la conversación, y ve los que le manda el equipo.
- **Persona del equipo:** ve lo que envía el cliente y responde adjuntando archivos. No hay login ni roles (principio 11).
- **Chatbot:** no envía archivos y no interpreta los que recibe.

## Historias de usuario

### HU-1 — El cliente manda un archivo (P1)

Como cliente, quiero mandar una foto, un audio o un documento, para explicar mi caso sin tener que escribirlo todo.

- Dado que estoy en una conversación, cuando adjunto un archivo permitido y lo envío, entonces aparece en la conversación como un mensaje mío.
- Dado que adjunto un archivo, cuando además escribo un texto, entonces ambos viajan como un solo mensaje.
- Dado que el archivo supera el tamaño permitido o es de un tipo que no se acepta, cuando intento enviarlo, entonces se me dice el motivo y el mensaje no se envía.
- Dado que la subida falla a mitad, cuando ocurre, entonces se me avisa y puedo reintentar sin perder lo que escribí.

### HU-2 — El equipo ve y responde con archivos (P1)

Como persona del equipo, quiero ver lo que manda el cliente y poder responderle con un archivo, para resolver el caso.

- Dado que el cliente envió una imagen, cuando abro la conversación, entonces la veo sin tener que descargarla.
- Dado que el cliente envió un audio, cuando abro la conversación, entonces puedo escucharlo ahí mismo.
- Dado que el cliente envió un documento, cuando abro la conversación, entonces puedo abrirlo o descargarlo, con su nombre original.
- Dado que la conversación está en modo humano, cuando adjunto un archivo y respondo, entonces le llega al cliente en pocos segundos, identificado como enviado por una persona del equipo.

### HU-3 — El bot no adivina lo que no puede leer (P1)

Como persona del equipo, quiero que el bot no invente lo que hay en un archivo, para no dar respuestas equivocadas.

- Dado que la conversación está en modo IA, cuando el cliente envía un archivo, entonces el bot le dice que una persona lo va a revisar y deriva la conversación.
- Dado que el bot deriva por un archivo, cuando miro la conversación, entonces la nota interna dice que derivó porque recibió un archivo que no puede leer.
- Dado que el cliente envía un archivo junto con una pregunta que el bot sí sabe responder, cuando ocurre, entonces el bot igualmente deriva. *(decisión propia: responder solo a la mitad del mensaje confunde más de lo que ayuda)*

### HU-4 — Saber qué se guarda (P2)

Como cliente, quiero saber que lo que mando se guarda, para decidir qué envío.

- Dado que abro una conversación, cuando leo el aviso, entonces sé que la conversación y lo que adjunte se guardan (Ley 1581).
- Dado que el equipo borra una conversación, cuando se borra, entonces sus archivos dejan de estar disponibles.

## Requisitos funcionales

- **FR-001:** Un mensaje puede llevar un archivo adjunto, con o sin texto acompañante. *(decisión propia: un archivo por mensaje; varios se envían en varios mensajes)*
- **FR-002:** Se aceptan imágenes, audios y documentos. Los documentos son los mismos tipos que ya acepta la base de conocimiento: PDF, Word (.docx) y texto plano (.txt). *(decisión propia, por coherencia con 002)*
- **FR-003:** Cada archivo puede pesar como máximo 4 MB. *(mismo límite que 002, por la misma restricción externa)*
- **FR-004:** Un archivo de un tipo no aceptado o que supera el tamaño se rechaza indicando el motivo, y el mensaje no se envía.
- **FR-005:** Tanto el cliente como la persona del equipo pueden adjuntar archivos. El bot nunca los envía (principio 10).
- **FR-006:** Cada mensaje con archivo indica quién lo envió, igual que los de texto (004, FR-003).
- **FR-007:** Las imágenes se ven dentro de la conversación y los audios se escuchan ahí mismo, sin descargarlos.
- **FR-008:** Los documentos se pueden abrir o descargar conservando su nombre original.
- **FR-009:** En modo IA, recibir un archivo hace que el bot avise al cliente de que lo revisará una persona y derive la conversación (principios 8 y 9).
- **FR-010:** Al derivar por un archivo, el bot deja una nota interna con ese motivo, visible solo para el equipo (004, FR-011 y FR-012).
- **FR-011:** Una conversación cuyo último mensaje es un archivo del cliente cuenta como pendiente igual que si fuera texto (004, FR-018).
- **FR-012:** Borrar una conversación borra también sus archivos (004, FR-006).
- **FR-013:** El aviso de que la conversación se guarda (004, FR-004) incluye que lo adjuntado también se guarda.
- **FR-014:** Un archivo que no se pudo subir no deja un mensaje a medias en la conversación.
- **FR-015:** El bot no recibe el contenido de los archivos, así que adjuntar uno no consume saldo de la API key más allá de la derivación.

## Casos borde

- **Archivo más grande que el límite:** se rechaza antes de enviarlo, diciendo el tamaño permitido (FR-004).
- **Tipo no permitido (por ejemplo, un video o un ejecutable):** se rechaza indicando qué tipos se aceptan (FR-004).
- **Se corta la red a mitad de la subida:** el mensaje no se envía y se puede reintentar; no queda un mensaje vacío (FR-014). *(decisión propia)*
- **Se reintenta el mismo envío dos veces:** el archivo aparece una sola vez en la conversación, igual que los mensajes de texto (004).
- **Archivo dañado o que no se puede mostrar:** aparece igualmente como archivo recibido, con su nombre, para que el equipo sepa que el cliente envió algo. *(decisión propia: no se descarta lo que el cliente mandó)*
- **Mensaje solo con archivo, sin texto:** es válido; la conversación lo muestra como un mensaje más.
- **Métricas (008):** un mensaje sin texto no aporta palabras al agrupamiento de temas, pero sí cuenta como mensaje de la conversación.
- **Aprendizaje (005):** una respuesta del equipo que solo lleva un archivo no genera propuesta de conocimiento, porque no hay texto que aprender. *(decisión propia)*
- **Simulaciones (009):** las simulaciones solo envían texto; esta feature no las cambia.

## Entidades clave

- **Adjunto:** el archivo que acompaña a un mensaje, con su nombre original, su tipo (imagen, audio o documento) y su tamaño. Pertenece a un único mensaje de una única conversación.
- **Mensaje:** el de la 004, que ahora puede llevar un adjunto además de (o en lugar de) texto.

## Criterios de éxito

- **SC-001:** El cliente envía una imagen, un audio y un documento, y los tres aparecen en la conversación del equipo, reproducibles o descargables según su tipo.
- **SC-002:** La persona del equipo responde con un archivo y el cliente lo recibe en pocos segundos, sin recargar.
- **SC-003:** Un archivo enviado en modo IA deriva la conversación y deja la nota interna con el motivo, sin que el bot afirme nada sobre su contenido.
- **SC-004:** Un archivo de un tipo no aceptado, y uno que supera los 4 MB, se rechazan indicando el motivo, y la conversación no queda con un mensaje a medias.
- **SC-005:** Al borrar una conversación con adjuntos, sus archivos dejan de estar disponibles.

## Restricciones externas

- **Tamaño de petición (Vercel):** el despliegue no acepta peticiones de más de 4,5 MB, lo que fija el límite de 4 MB por archivo. Es la misma restricción que ya se aplicó en la 002 (decisión del usuario, 2026-09-14).
- **Ley 1581 de 2012 (Habeas Data):** los archivos de un cliente pueden contener datos personales, y más que el texto: una foto de una cédula, un audio con su voz, un PDF con su dirección. Se le informa de que se guardan (FR-013) y el borrado de la conversación los elimina (FR-012). Sigue pendiente, como en la 004, definir un plazo de conservación cuando haya clientes reales (007).
- **Plataforma sin autenticación (principio 11):** no hay login, así que el proyecto asume que cualquiera que alcance la plataforma puede ver los archivos de las conversaciones. Este riesgo ya estaba aceptado para el texto de las conversaciones; con adjuntos de clientes reales pesa más, y el principio 11 pide revisarlo antes de usar la plataforma con datos reales.
- **WhatsApp (007):** el canal impondrá sus propios tipos y tamaños permitidos, que no coinciden necesariamente con los de aquí. `[NEEDS CLARIFICATION: los límites y formatos concretos de WhatsApp Cloud API se verifican al especificar la 007; no se copian aquí sin confirmarlos en la documentación oficial]`

## Fuera de alcance

- **Que el bot entienda audios o imágenes** (transcripción, descripción de fotos, lectura de texto en imágenes). Es un cambio de modelo y de costo que merece su propia feature; aquí el bot deriva. *(decisión propia)*
- **Video.** El roadmap nombra audios, imágenes y documentos.
- Que los archivos de una conversación alimenten la base de conocimiento (eso es 002 y 005).
- Grabar audio desde la plataforma: se adjuntan archivos que ya existen. *(decisión propia)*
- Editar, recortar o comprimir archivos.
- Varios archivos en un mismo mensaje (FR-001).
- Vista previa de documentos dentro de la plataforma: se abren o se descargan (FR-008).

## Preguntas abiertas

- Los tipos y tamaños que permite WhatsApp, que pueden obligar a ajustar FR-002 y FR-003 cuando se especifique la 007. No se escriben aquí cifras sin verificarlas en la documentación oficial de Meta.
- El plazo de conservación de los archivos, heredado de la misma pregunta abierta de la 004.

## Diferido al plan

- Dónde se guardan los archivos y cómo se sirven.
- Cómo se evita que un archivo quede huérfano si el mensaje no llega a guardarse (FR-014).
- Cómo se valida que un archivo es del tipo que dice ser (principio 3: todo lo que viene de fuera es no confiable).
- Cómo se borran los archivos al borrar la conversación (FR-012).
- Cómo llegan al cliente los archivos del equipo en pocos segundos, sobre el mecanismo que ya usa la 004.
