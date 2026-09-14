# 001 — Configuración del chatbot

- **Estado:** Approved (2026-09-13)
- **Fecha:** 2026-09-13
- **Origen:** `roadmap.md`, feature 001

## Resumen

La plataforma tiene un único chatbot para una única empresa. Esta feature permite editar su configuración: el nombre de la empresa, el prompt de comportamiento (con un texto por defecto) y el proveedor de LLM, el modelo y la API key con los que funciona el bot.

Sin esta configuración el chatbot no puede funcionar. Es la base de la que dependen el resto de las features.

## Actores

- **Persona configuradora:** cualquier persona que entra a la plataforma. No hay login ni roles (constitución, principio 11).

## Historias de usuario

### HU-1 — Definir la identidad y el comportamiento del bot (P1)

Como persona configuradora, quiero indicar el nombre de la empresa y el prompt de comportamiento, para que el chatbot se presente y responda con el tono de la empresa.

- Dado que abro la configuración por primera vez, cuando la veo, entonces el nombre de la empresa está vacío y el prompt contiene el texto por defecto.
- Dado que escribo un nombre y edito el prompt, cuando guardo, entonces veo una confirmación y, al recargar la plataforma, se mantienen los valores guardados.
- Dado que dejo el nombre vacío o solo con espacios, cuando guardo, entonces se me indica que el nombre es obligatorio y no se guarda ningún cambio.

### HU-2 — Elegir con qué LLM funciona el bot (P1)

Como persona configuradora, quiero elegir el proveedor de LLM y el modelo e ingresar la API key, para que el chatbot pueda funcionar.

- Dado que elijo un proveedor, cuando veo la lista de modelos, entonces solo aparecen modelos de ese proveedor.
- Dado que ingreso una API key y guardo, cuando vuelvo a ver la configuración, entonces la key aparece enmascarada (solo los últimos 4 caracteres, p. ej. `…abcd`) y no hay forma de verla completa.
- Dado que ya hay una key guardada, cuando guardo otros cambios sin tocar el campo de la key, entonces la key guardada se conserva.
- Dado que ya hay una key guardada, cuando ingreso una nueva y guardo, entonces la nueva reemplaza a la anterior.

### HU-3 — Restaurar el prompt por defecto (P2)

Como persona configuradora, quiero volver al prompt por defecto, para deshacer una personalización que no funcionó.

- Dado que el prompt fue modificado, cuando elijo "restaurar prompt por defecto" y confirmo, entonces el prompt vuelve al texto por defecto.
- Dado que elijo restaurar, cuando cancelo la confirmación, entonces el prompt no cambia.

### HU-4 — Conocer las reglas que el bot siempre cumple (P2)

Como persona configuradora, quiero ver qué reglas no puedo cambiar desde el prompt, para entender los límites del bot.

- Dado que estoy en la configuración, cuando veo la sección del prompt, entonces se muestran como reglas fijas y no editables: no inventa respuestas; deriva a una persona cuando no sabe, cuando el cliente está enojado o cuando pide reiteradamente hablar con una persona; solo informa sobre la empresa y agenda citas.

## Requisitos funcionales

- **FR-001:** Existe exactamente una configuración. La plataforma no permite crear otra ni eliminarla.
- **FR-002:** El nombre de la empresa es obligatorio. Un nombre vacío o formado solo por espacios se rechaza.
- **FR-003:** El prompt de comportamiento viene prellenado con el texto por defecto (ver "Prompt por defecto") y se puede editar.
- **FR-004:** Existe la opción "restaurar prompt por defecto", que pide confirmación antes de reemplazar el prompt.
- **FR-005:** La plataforma muestra las reglas fijas de los principios 8, 9 y 10 de la constitución como no editables, y deja claro que se aplican aunque el prompt diga lo contrario.
- **FR-006:** Se puede elegir un proveedor de LLM de una lista y un modelo de ese proveedor. La lista de proveedores y modelos es dinámica: agregar o quitar opciones no debe requerir cambiar esta spec. Proveedores iniciales: OpenAI y OpenRouter (definidos por el usuario el 2026-09-14).
- **FR-007:** Se puede ingresar una API key. Una vez guardada, nunca se vuelve a mostrar completa; solo se ven sus últimos 4 caracteres.
- **FR-008:** Guardar sin tocar el campo de la API key conserva la key guardada. Ingresar una nueva la reemplaza.
- **FR-009:** Al cambiar de proveedor, se exige ingresar una API key nueva antes de guardar.
- **FR-010:** Al guardar, si algún campo es inválido, se indica cuál y no se guarda ningún cambio. Si todo es válido, se muestra una confirmación.
- **FR-011:** Los valores guardados se mantienen al recargar la plataforma o al entrar desde otro navegador.
- **FR-012:** Si dos personas editan a la vez, prevalece lo último que se guarda, sin aviso.
- **FR-013:** Al guardar una API key nueva, la plataforma verifica con el proveedor que la key funciona. Si no funciona, o si no se puede verificar, se muestra el motivo y no se guarda ningún cambio.
- **FR-014:** La plataforma muestra si la configuración está "completa" (nombre, proveedor, modelo y key verificada) o "incompleta", indicando qué falta.
- **FR-015:** El prompt tiene un largo máximo. Al superarlo se muestra un mensaje claro y no se guarda.
- **FR-016:** Si se intenta salir de la configuración con cambios sin guardar, la plataforma avisa antes de descartarlos.

## Prompt por defecto (borrador para aprobar)

> Eres el asistente virtual de {nombre de la empresa}. Atiendes a los clientes por chat en español, con un tono cordial, claro y profesional.
> Responde de forma breve y directa. Si la pregunta no es clara, pide que la aclaren.
> Saluda solo al inicio de la conversación y preséntate como el asistente de {nombre de la empresa}.

`{nombre de la empresa}` se reemplaza por el nombre configurado. El borrador no repite las reglas fijas porque ya se aplican siempre (FR-005).

## Casos borde

- **Primera vez:** la configuración existe con el nombre vacío, el prompt por defecto y sin proveedor, modelo ni key.
- **Prompt vacío:** no se puede guardar un prompt vacío; se ofrece restaurar el prompt por defecto. *(supuesto, ver reporte de validación)*
- **Prompt muy largo:** se rechaza al superar el largo máximo (FR-015).
- **API key con espacios al inicio o al final:** se ignoran los espacios.
- **API key inválida o del proveedor equivocado:** se rechaza al verificarla (FR-013).
- **El proveedor no responde al verificar:** no se guarda; se avisa que no se pudo verificar y que se reintente (FR-013).
- **Guardar dos veces seguidas:** el resultado es el mismo que guardar una vez.
- **Salir sin guardar:** se avisa antes de descartar los cambios (FR-016).
- **El proveedor deja de ofrecer el modelo elegido:** fuera del alcance de esta spec; se trata en la 003, que es donde el bot lo usa.

## Entidades clave

- **Configuración del chatbot:** única. Tiene el nombre de la empresa, el prompt de comportamiento y la conexión con el LLM. Más adelante contendrá la base de conocimiento (002) y la cuenta de Google (006).
- **Conexión con el LLM:** proveedor, modelo de ese proveedor y API key (secreta).
- **Reglas fijas:** las reglas de los principios 8, 9 y 10. No forman parte de la configuración editable.

## Criterios de éxito

- **SC-001:** Una persona sin instrucciones previas completa la configuración (nombre, proveedor, modelo y key) en menos de 3 minutos.
- **SC-002:** Después de guardar, en ninguna pantalla de la plataforma aparece la API key completa.
- **SC-003:** El 100 % de los intentos de guardar un nombre vacío o solo con espacios se rechazan.
- **SC-004:** Los valores guardados se ven iguales al recargar y desde otro navegador.
- **SC-005:** "Restaurar prompt por defecto" deja el prompt exactamente igual al texto por defecto.
- **SC-006:** Ninguna API key que el proveedor rechace queda guardada.

## Restricciones externas

- **Proveedor de LLM:** cada proveedor tiene sus propios términos de uso, sus precios y su catálogo de modelos, que cambia con el tiempo. Se revisan cuando se elijan los proveedores.
- **Costo:** todo uso del bot consume el saldo de la API key; es un riesgo aceptado (principio 11).
- **Ley 1581 de 2012:** esta feature no guarda datos personales de clientes finales. La API key es un secreto, no un dato personal.

## Fuera de alcance

- Varias configuraciones, multiempresa, activar o desactivar configuraciones.
- Eliminar o duplicar la configuración, e historial de versiones del prompt.
- Login, cuentas y roles.
- Carga de información de la empresa (002).
- Conectar la cuenta de Google (006) y WhatsApp (007).
- Conversar con el bot o probarlo (003).

## Preguntas abiertas

Ninguna. La pregunta sobre los proveedores se resolvió el 2026-09-14: OpenAI y OpenRouter.

## Diferido al plan

- Cómo y dónde se guardan la configuración y la API key de forma segura.
- Cómo se combinan el prompt de comportamiento y las reglas fijas al hablar con el LLM.
- De dónde sale la lista de modelos de cada proveedor.
- Cómo se hace la verificación de la key, si se decide hacerla.
- El valor del largo máximo del prompt, si se decide tenerlo.
