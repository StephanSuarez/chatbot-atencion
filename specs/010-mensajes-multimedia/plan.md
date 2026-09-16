# Plan técnico — 010 Mensajes multimedia

- **Estado:** Approved (2026-09-15)
- **Spec:** `specs/010-mensajes-multimedia/spec.md`

> Aprobado por delegación del usuario (2026-09-15). Cada decisión importante va con su alternativa y su motivo en §12.

## 1. Contexto

Las conversaciones (004) solo llevan texto. Esta feature permite que el cliente y el equipo adjunten una imagen, un audio o un documento a un mensaje, y que ambos lo vean. El bot no interpreta esos archivos: al recibir uno en modo IA, deriva (spec, FR-009).

Restricciones que mandan sobre el diseño:

- **Principio 2:** la solución más simple que cumpla la spec, sin infraestructura para necesidades futuras.
- **Principio 3:** lo que llega de fuera es no confiable. Un archivo subido es el caso más claro.
- **Principio 4:** minimización; borrar la conversación borra sus archivos.
- **Principio 11:** no hay login. Quien alcance la plataforma alcanza los archivos.
- **4 MB por archivo** (spec, FR-003), ya soportado por la configuración actual.

## 2. Estado actual

- **Conversaciones y mensajes:** `conversation_entries` guarda `seq`, `conversationId`, `author` (`cliente`, `bot`, `equipo`, `nota`, `evento`), `text` **not null**, `clientMessageId` único (un reintento no duplica) y `createdAt`. Se borran en cascada con su conversación.
- **Cómo se leen:** el cliente y el equipo consultan las entradas nuevas desde la última conocida (`seq`), cada pocos segundos. Es el camino caliente de la feature.
- **Cómo se suben archivos hoy:** `uploadDocumentAction` (base de conocimiento, 002) recibe un `FormData`, comprueba `instanceof File` y el tamaño, y pasa los bytes al servicio. **No se guarda el archivo original:** se extrae el texto y se descarta (plan 002 §5).
- **Configuración:** `next.config.ts` ya fija `serverActions.bodySizeLimit: "4.5mb"`, puesto para los documentos de 4 MB de la 002. El límite por defecto de Next es 1 MB (documentación local, `serverActions.md`).
- **Almacenamiento:** todo vive en Postgres. No hay ningún almacenamiento de objetos configurado ni ningún SDK de almacenamiento entre las dependencias; el entorno solo define `DATABASE_URL`, `ENCRYPTION_KEY` y las credenciales de Google.
- **Route handlers:** solo existe el callback de Google. No hay ninguno que sirva binarios.

**Deuda que afecta aquí:** no hay precedente de guardar bytes. Esta feature lo introduce, y con él la primera superficie de la plataforma que devuelve contenido subido por un tercero.

## 3. Arquitectura propuesta

Subida y envío:

```
Cliente / equipo
  ↓ (FormData: archivo + texto)
Server action de la conversación
  ↓ valida tipo, tamaño y contenido real
Servicio de conversaciones
  ↓ una transacción
Mensaje (conversation_entries) + Adjunto (conversation_attachments)
```

Lectura:

```
Cliente / equipo
  ↓ sondeo de entradas nuevas (sin bytes)
Mensaje con la ficha del adjunto (id, nombre, tipo, tamaño)
  ↓ <img>, <audio> o enlace
GET /api/adjuntos/{id}
  ↓
Route handler → bytes desde Postgres
```

La clave del diseño es que **los bytes nunca viajan por el camino caliente**: el sondeo trae la ficha del adjunto, y el binario se pide una sola vez por su propia URL, que el navegador cachea.

## 4. Componentes y responsabilidades

| Componente | Responsabilidad | No debe |
|---|---|---|
| **Server action de envío** (existe, se amplía) | Recibir el `FormData`, validar tipo y tamaño, y delegar | Escribir en la base directamente |
| **Servicio de conversaciones** (existe, `lib/conversations/`) | Guardar mensaje y adjunto en una sola transacción; borrarlos en cascada | Saber de HTTP o de `FormData` |
| **Validación de archivos** (nueva, `lib/attachments/`) | Decidir si un archivo es aceptable: extensión, tipo declarado y **contenido real**; decir a qué categoría pertenece (imagen, audio, documento) | Guardar nada |
| **Route handler de adjuntos** (nuevo) | Devolver los bytes con las cabeceras seguras | Aceptar el tipo que declaró quien subió |
| **Servicio de chat** (existe, `lib/chat/`) | Ante un mensaje con adjunto en modo IA, derivar con el motivo correspondiente | Mandar el archivo al proveedor |

## 5. Datos y persistencia

Migración `0007`:

- **`conversation_attachments`** (tabla nueva): id, la entrada a la que pertenece (**única**: un adjunto por mensaje, FR-001; `on delete cascade`), nombre original, categoría (`imagen`, `audio`, `documento`), tipo de contenido ya normalizado, tamaño y los bytes.
- **`conversation_entries.text`** se queda **not null**: un mensaje solo-archivo guarda cadena vacía. Evita revisar todos los consumidores actuales (métricas, aprendizaje, historial del bot), que hoy asumen que siempre hay texto.

**Por qué una tabla aparte y no columnas en la entrada:** las entradas se consultan cada pocos segundos. Si los bytes vivieran en esa fila, cualquier consulta que no listara columnas explícitamente los arrastraría en cada sondeo. En tabla aparte, el binario solo se lee cuando alguien pide el archivo.

**Ciclo de vida:** el adjunto se borra con su mensaje, y el mensaje con su conversación (cascada ya existente). No hay borrado de adjuntos por separado.

**Consistencia:** mensaje y adjunto se escriben en la misma transacción. Si falla la escritura del adjunto, no queda el mensaje a medias (FR-014).

`ponytail:` los bytes van en Postgres. El techo es el tamaño de la base: 4 MB por archivo, sin caducidad y con borrado manual. El siguiente paso, si con la 007 entran archivos de clientes reales en volumen, es mover los bytes a un almacenamiento de objetos dejando la ficha en la tabla.

## 6. Integraciones externas

Ninguna nueva. Es el punto a favor del diseño: no aparecen credenciales, ni un servicio que pueda estar caído, ni una cuenta que el usuario tenga que crear.

El proveedor de LLM **no** recibe los archivos (spec, FR-015): al recibir un adjunto en modo IA la derivación se decide en el código, sin preguntarle al modelo.

## 7. Seguridad y privacidad

Es la sección que más pesa en esta feature: es la primera vez que la plataforma devuelve contenido que subió un tercero.

- **Validación por contenido, no por nombre.** Se comprueba la extensión, el tipo declarado y los **primeros bytes** del archivo. Un `.png` que por dentro no es un PNG se rechaza (principio 3).
- **El tipo que se sirve lo decide el servidor.** El route handler responde con el tipo de la lista permitida, nunca con el que declaró quien subió.
- **`X-Content-Type-Options: nosniff`** en la respuesta, para que el navegador no reinterprete el contenido.
- **Los documentos se descargan, no se abren en la página** (`Content-Disposition: attachment`). Un documento servido en línea desde el mismo origen es la vía clásica de XSS almacenado.
- **Sin SVG.** Es el formato de imagen que puede llevar script dentro; queda fuera de la lista.
- **El nombre original no viaja crudo en las cabeceras:** se codifica, para que un nombre con comillas o saltos de línea no inyecte cabeceras.
- **Sin autenticación (principio 11):** lo único que protege un archivo es que su identificador no se puede adivinar. Es coherente con el riesgo ya aceptado para el texto de las conversaciones, pero con adjuntos de clientes reales pesa más. Queda anotado en la spec y en el principio 11, que pide revisarlo antes de usar la plataforma con datos reales.
- **Nada de datos personales en los logs:** se registra el identificador del adjunto y su tamaño, nunca su nombre ni su contenido.

## 8. Fallos y casos borde

- **Archivo demasiado grande:** se rechaza en el navegador antes de enviarlo y también en el servidor. El límite del servidor es el que manda; el del navegador solo evita una subida inútil.
- **Se corta la subida:** la server action no llega a ejecutarse, así que no hay mensaje ni adjunto. La pantalla avisa y conserva el texto escrito (FR-014).
- **Reintento del mismo envío:** el `clientMessageId` ya existente hace que el mensaje no se duplique, igual que hoy con el texto. El adjunto cuelga del mensaje, así que tampoco se duplica.
- **Archivo que pasa la validación pero está dañado:** se guarda y se muestra como archivo recibido con su nombre. No se descarta lo que el cliente mandó (spec).
- **Piden un adjunto que ya no existe** (se borró la conversación): el route handler responde «no encontrado», sin filtrar si alguna vez existió.
- **Mensaje solo con archivo:** texto vacío; la conversación lo muestra igual.
- **Adjunto en modo IA:** deriva por regla de código, aunque el prompt diga lo contrario (004, FR-013).

## 9. Estrategia de pruebas

- **Unitarias — validación de archivos:** por cada tipo permitido, uno válido y uno cuyo contenido no corresponde a su extensión; tamaño en el límite y por encima; SVG rechazado. Cubre SC-004.
- **Integración — guardar y leer:** un mensaje con adjunto queda con su ficha; borrar la conversación borra el adjunto; un reintento con el mismo `clientMessageId` no duplica. Cubre SC-001 y SC-005.
- **Integración — derivación:** un adjunto en modo IA deriva y deja la nota con el motivo, sin llamar al proveedor. Cubre SC-003.
- **Integración — servir:** el tipo devuelto es el de la lista y no el declarado; los documentos van como descarga; un id inexistente responde «no encontrado».
- **Manual:** SC-002 (el equipo responde con un archivo y le llega al cliente en pocos segundos) se comprueba en el navegador, como se hizo con la 004.

## 10. Observabilidad

Se registra el motivo de cada rechazo (tipo, tamaño o contenido que no corresponde), con el identificador del adjunto y su tamaño. Nunca el nombre ni el contenido, que pueden llevar datos personales.

## 11. Despliegue y migración

- Migración `0007`, que solo agrega una tabla: no toca datos existentes y las conversaciones actuales siguen funcionando igual.
- **Sin cambios de configuración:** `bodySizeLimit` ya está en 4,5 MB desde la 002.
- **Compatible hacia atrás:** un mensaje sin adjunto se comporta exactamente como hoy.

## 12. Decisiones y alternativas

**Decisión: los bytes se guardan en Postgres.**
Alternativas: un almacenamiento de objetos (Vercel Blob, S3, Supabase Storage) o el sistema de archivos.
Motivo: hoy no hay ningún almacenamiento de objetos configurado ni ningún SDK instalado; añadirlo son credenciales nuevas, una cuenta que el usuario tendría que crear y un servicio más que puede fallar, para una feature que el proyecto usa con un puñado de conversaciones. El sistema de archivos se descarta porque no sobrevive a un despliegue efímero. El techo queda anotado con `ponytail:` en §5.

**Decisión: tabla de adjuntos aparte, no columnas en la entrada.**
Alternativas: columnas anulables en `conversation_entries`.
Motivo: las entradas se consultan cada pocos segundos; los binarios no pueden estar en esa fila.

**Decisión: `text` sigue not null, con cadena vacía para los mensajes solo-archivo.**
Alternativas: hacerla anulable.
Motivo: métricas, aprendizaje e historial del bot ya asumen que hay texto. Una columna anulable obliga a revisarlos todos para no ganar nada.

**Decisión: el servidor impone el tipo de contenido al servir.**
Alternativas: devolver el tipo que declaró quien subió.
Motivo: es contenido de un tercero servido desde el propio origen; confiar en el tipo declarado es exactamente como se consigue un XSS almacenado.

**Decisión: la derivación por adjunto se decide en el código.**
Alternativas: instruir al modelo para que derive cuando le digan que llegó un archivo.
Motivo: es una regla que debe cumplirse siempre (004, FR-013), y además evita gastar saldo en una llamada cuyo resultado ya se conoce (FR-015).

## 13. Riesgos

- **Crecimiento de la base.** Impacto medio, probabilidad media con la 007. 4 MB por archivo sin caducidad. Mitigación: el borrado de conversaciones ya elimina los adjuntos, y el camino de salida está anotado en §5.
- **XSS almacenado.** Impacto alto, probabilidad baja con los controles de §7. Es el riesgo real de la feature y por eso los controles no se difieren a la implementación.
- **Archivos alcanzables sin autenticación.** Impacto alto si hubiera datos reales, probabilidad alta por diseño (principio 11). No se mitiga aquí: se hace explícito, porque el principio ya pide revisarlo antes de usar la plataforma con datos reales.

## 14. Preguntas técnicas abiertas

- Los tipos y tamaños que permite WhatsApp pueden obligar a ajustar la lista cuando se especifique la 007. No se copian cifras sin verificarlas en la documentación de Meta (heredado de la spec).
- Cómo declara Drizzle una columna de bytes en esta versión: se confirma al implementar, y no cambia el diseño.
