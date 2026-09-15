# 002 — Base de conocimiento

- **Estado:** Approved (2026-09-14)
- **Fecha:** 2026-09-14
- **Origen:** `roadmap.md`, feature 002

## Resumen

La persona configuradora carga la información de la empresa (horarios, qué vende, cómo vende, etc.) para que el chatbot la conozca. La información se carga de dos formas: entradas de texto escritas en la plataforma y documentos subidos.

El bot solo responde con esta información y con su prompt (constitución, principio 8). Esta feature cubre cargar y administrar la información; que el bot la use al conversar es la 003.

## Actores

- **Persona configuradora:** cualquier persona que entra a la plataforma. No hay login ni roles (constitución, principio 11).

## Historias de usuario

### HU-1 — Escribir información de la empresa (P1)

Como persona configuradora, quiero escribir la información de la empresa organizada por temas, para que el bot la conozca sin tener que preparar documentos.

- Dado que no hay información cargada, cuando abro la base de conocimiento, entonces veo que está vacía y cómo agregar la primera entrada.
- Dado que escribo un título y un contenido, cuando guardo, entonces la entrada aparece en la lista y se mantiene al recargar.
- Dado que edito una entrada y guardo, cuando vuelvo a verla, entonces tiene el contenido nuevo.
- Dado que elijo eliminar una entrada, cuando confirmo, entonces desaparece; si cancelo, no cambia nada.
- Dado que dejo el título o el contenido vacío, cuando guardo, entonces se me indica qué falta y no se guarda.

### HU-2 — Subir documentos de la empresa (P1)

Como persona configuradora, quiero subir documentos que ya tengo (por ejemplo, un menú o una lista de precios), para no tener que reescribirlos.

- Dado que subo un PDF, Word (.docx) o .txt de hasta 4 MB, cuando termina de subir, entonces aparece en la lista con su nombre, fecha y estado "procesando", y después "listo".
- Dado que subo un archivo de otro tipo o de más de 4 MB, cuando lo intento, entonces se me indica el motivo y no se agrega.
- Dado que ya hay 20 documentos, cuando intento subir otro, entonces se me indica el límite y no se agrega.
- Dado que subo un archivo idéntico a uno ya cargado, cuando lo intento, entonces se me avisa y no se duplica.
- Dado que elijo eliminar un documento, cuando confirmo, entonces desaparece y el bot deja de conocer su contenido; si cancelo, no cambia nada.

### HU-3 — Comprobar qué va a saber el bot (P2)

Como persona configuradora, quiero ver el texto que se sacó de cada documento, para confirmar que el bot lo va a entender.

- Dado que un documento está "listo", cuando abro su detalle, entonces veo el texto extraído en solo lectura.
- Dado que un documento no se pudo leer (por ejemplo, un PDF escaneado que solo tiene imágenes, o un archivo dañado), cuando veo la lista, entonces tiene el estado "no se pudo leer" con el motivo.

## Requisitos funcionales

- **FR-001:** La base de conocimiento pertenece a la única configuración del chatbot (001).
- **FR-002:** Se pueden crear, editar y eliminar entradas de texto. Cada entrada tiene un título y un contenido, ambos obligatorios.
- **FR-003:** Se pueden subir documentos PDF, Word (.docx) y texto plano (.txt), de hasta 4 MB cada uno. *(Bajado de 10 MB el 2026-09-14, durante el plan: Vercel no acepta peticiones de más de 4,5 MB. Decisión del usuario.)*
- **FR-004:** Puede haber como máximo 20 documentos. Al llegar al límite, no se permite subir más hasta eliminar alguno.
- **FR-005:** Los documentos no se editan en la plataforma. Para cambiar uno, se elimina y se sube de nuevo.
- **FR-006:** Cada documento muestra su estado: "procesando", "listo" o "no se pudo leer" (con el motivo).
- **FR-007:** Un documento del que no se puede extraer texto (PDF escaneado, archivo dañado o protegido con contraseña) queda en "no se pudo leer". No se hace reconocimiento de texto en imágenes.
- **FR-008:** El texto extraído de un documento "listo" se puede ver en solo lectura.
- **FR-009:** Subir un archivo idéntico a uno ya cargado se rechaza con un aviso.
- **FR-010:** Eliminar una entrada o un documento pide confirmación. Lo eliminado deja de formar parte de lo que sabe el bot.
- **FR-011:** Solo lo que está "listo" (documentos) o guardado (entradas) forma parte de lo que sabe el bot.
- **FR-012:** Se puede cargar información aunque la configuración del chatbot esté incompleta (sin proveedor, modelo o API key).
- **FR-013:** La plataforma muestra un aviso pidiendo no incluir datos personales de clientes en la base de conocimiento.
- **FR-014:** El contenido puede estar en cualquier idioma.
- **FR-015:** La información cargada se mantiene al recargar la plataforma o al entrar desde otro navegador.

## Casos borde

- **Base vacía:** se muestra vacía, con la forma de agregar la primera entrada o documento. El bot todavía no sabe nada de la empresa (en la 003 dirá que va a consultar y derivará, principio 8).
- **Entrada con título o contenido solo con espacios:** se trata como vacía y se rechaza.
- **Documento sin texto útil:** "no se pudo leer" (FR-007).
- **Documento que se sube mientras otro está "procesando":** se agrega a la lista y se procesa también.
- **El procesamiento falla por un problema temporal:** queda en "no se pudo leer" con un motivo que invita a subirlo de nuevo. *(supuesto, ver reporte de validación)*
- **Se elimina un documento mientras está "procesando":** se elimina y no pasa a formar parte de lo que sabe el bot.
- **Se sube el mismo archivo con otro nombre:** se considera idéntico si su contenido es el mismo (FR-009).
- **Dos personas editan la misma entrada a la vez:** prevalece lo último que se guarda, como en la 001.
- **Recargar la página mientras un documento está "procesando":** el documento sigue en la lista y su estado se actualiza.

## Entidades clave

- **Base de conocimiento:** todo lo que el bot sabe de la empresa. Pertenece a la configuración del chatbot.
- **Entrada de texto:** un tema con título y contenido, escrito en la plataforma.
- **Documento:** un archivo subido, con su nombre, fecha, estado y el texto extraído.

## Criterios de éxito

- **SC-001:** Una persona agrega una entrada de texto y sube un documento sin instrucciones previas en menos de 2 minutos.
- **SC-002:** Un PDF, un .docx y un .txt con texto quedan en "listo", y su texto extraído coincide con el contenido del archivo.
- **SC-003:** Un PDF escaneado (solo imágenes) queda en "no se pudo leer" con el motivo.
- **SC-004:** El 100 % de los archivos de otro tipo, de más de 4 MB o por encima del límite de 20 se rechazan sin agregarse.
- **SC-005:** Tras eliminar una entrada o un documento, ya no aparece en la plataforma ni al recargar.
- **SC-006:** La información cargada se ve igual al recargar y desde otro navegador.

## Restricciones externas

- **Ley 1581 de 2012 (Habeas Data):** la base de conocimiento es información de la empresa, no de sus clientes. Para no tratar datos personales sin necesidad (constitución, principio 4), se muestra un aviso (FR-013). La plataforma no revisa el contenido.
- **Documentos subidos:** son entrada externa y no confiable (constitución, principio 3): pueden estar dañados, ser de otro tipo del que dicen o traer contenido inesperado.
- **Proveedor de LLM:** si procesar la información requiere al proveedor, eso consume el saldo de la API key (riesgo aceptado, principio 11). Se define en el plan.

## Fuera de alcance

- Conversar con el bot o probar sus respuestas (003).
- Páginas web o URLs, imágenes sueltas, hojas de cálculo y otros formatos.
- Reconocimiento de texto en imágenes (OCR).
- Editar documentos en la plataforma e historial de versiones.
- Respuestas aprendidas de las derivaciones (005).

## Preguntas abiertas

Ninguna.

## Diferido al plan

- Cómo se extrae el texto de cada tipo de documento.
- Cómo se guarda y se organiza la información para que el bot encuentre lo relevante al responder (003).
- Si el procesamiento usa el proveedor de LLM configurado y qué pasa si la configuración está incompleta (FR-012).
- Cómo se detecta que dos archivos son idénticos.
- Dónde se guardan los archivos originales, si se guardan.
