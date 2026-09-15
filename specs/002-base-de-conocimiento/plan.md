# Plan técnico — 002 Base de conocimiento

- **Estado:** Approved (2026-09-14)
- **Fecha:** 2026-09-14
- **Spec:** `specs/002-base-de-conocimiento/spec.md` (Approved; FR-003 bajado a 4 MB durante este plan)

## 1. Contexto

La persona configuradora carga información de la empresa como entradas de texto y documentos (PDF, .docx, .txt, hasta 4 MB, máximo 20). El bot solo puede responder con esa información (principio 8); responder es la 003.

Decisión central: **RAG con embeddings** (decisión del usuario, 2026-09-14). El proyecto existe para aprender la técnica. Se evaluó enviar toda la base al modelo en cada pregunta, que era más simple y alcanzaba para este volumen, pero el usuario ya conoce ese método.

Qué hace esta feature: extraer el texto, partirlo en pedazos y convertir cada pedazo en un vector (embedding) guardado en la base. Qué hace la 003: convertir la pregunta en vector, buscar los pedazos más parecidos y dárselos al modelo.

## 2. Estado actual

- Monolito Next.js 16, PostgreSQL 17 (Docker en local, Supabase en producción) y Drizzle ORM (plan 001).
- `lib/config-service.ts` tiene todas las reglas de la configuración y expone `getConfig()` y la key descifrada solo dentro del servidor.
- `lib/providers/` es el registro de proveedores (OpenAI y OpenRouter), con dos operaciones: verificar la key y listar modelos. Los errores se traducen a `invalid_key` o `unavailable`, con timeout de 10 s y logs sin la key.
- La pantalla de configuración (`app/config-form.tsx`) usa server actions (`app/actions.ts`) que validan la entrada.
- Pruebas con Vitest: unitarias con dependencias falsas e integración contra una base `_test`.

## 3. Arquitectura propuesta

```
Pantalla "Base de conocimiento"
   │ server actions (entradas, subir, eliminar, ver texto)
   ▼
Servicio de base de conocimiento ── reglas de la spec (límites, duplicados, estados)
   │            │                    │
   ▼            ▼                    ▼
Extractor    Partidor           Indexador ──► Registro de proveedores ──► API de embeddings
(PDF/docx/   (texto →           (pedazos sin      (nueva operación: embed)
 txt → texto) pedazos)           vector → vector)
   │            │                    │
   └────────────┴──────► PostgreSQL + pgvector (entradas, documentos, pedazos con vector)
```

**Flujo al subir un documento:**
1. El servidor valida el tipo por extensión y por contenido real (firma del archivo), el tamaño (≤ 4 MB), el límite de 20 y que no sea un duplicado (huella del contenido).
2. Guarda el documento como "procesando" y extrae el texto. Si no hay texto útil, lo marca "no se pudo leer" con el motivo.
3. Parte el texto en pedazos, los guarda sin vector y marca el documento como "listo".
4. Después de responder (con `after()` de Next), el **indexador** calcula los vectores de los pedazos pendientes con el proveedor configurado.

**Flujo al guardar una entrada de texto:** igual desde el paso 3. Al editarla, se borran sus pedazos y se crean de nuevo. Al eliminarla, se borran sus pedazos.

**Indexación pendiente (resuelve la tensión con FR-012):** extraer y partir no necesita la API key, así que un documento llega a "listo" (con su texto visible) aunque la configuración esté incompleta. Calcular vectores sí la necesita. Por eso el indexador procesa "todos los pedazos sin vector o con un modelo de embeddings distinto al actual". Se ejecuta:
- después de subir un documento o guardar una entrada;
- después de guardar la configuración con éxito, cuando cambia la key o el proveedor;
- en la 003, antes de buscar (red de seguridad).

La operación es idempotente: correrla dos veces no duplica nada. Mientras haya pedazos pendientes, la pantalla muestra un aviso: "Parte de la información todavía no está lista para el bot" y, si falta, "completa la configuración".

## 4. Componentes y responsabilidades

| Componente | Responsabilidad | No debe |
|---|---|---|
| **Pantalla de base de conocimiento** | Lista de entradas (crear, editar, eliminar con confirmación) y de documentos (subir, estado, ver texto, eliminar); aviso de datos personales (FR-013); aviso de indexación pendiente | Tener reglas propias; ver la API key |
| **Servicio de base de conocimiento** | Reglas de la spec: validación de entradas, tipos, tamaño, límite de 20, duplicados y estados; orquesta extraer → partir → guardar; lanza el indexador | Saber cómo se extrae cada formato ni cómo se calculan los vectores |
| **Extractor** | Del archivo al texto plano: PDF con `unpdf`, .docx con `mammoth`, .txt como UTF-8. Detecta "sin texto útil" (PDF escaneado, archivo dañado o protegido) | Guardar datos; conocer límites de negocio |
| **Partidor** | Del texto a pedazos de ~1.000 caracteres con ~150 de solapamiento, cortando por párrafos cuando se puede. Cada pedazo lleva como encabezado el título de la entrada o el nombre del documento | Llamar a servicios externos |
| **Indexador** | Busca pedazos pendientes, pide sus vectores al proveedor en lotes y los guarda con el nombre del modelo de embeddings | Decidir qué es "listo"; mostrar errores al usuario |
| **Registro de proveedores** (existe) | Nueva operación `embed(textos, key)`, que ambos proveedores implementan con la misma API compatible con OpenAI (`/v1/embeddings`), traduciendo errores como hoy | Guardar datos |

**Modelo de embeddings:** `text-embedding-3-small`, fijo (no configurable). En OpenAI se pide como `text-embedding-3-small` y en OpenRouter como `openai/text-embedding-3-small` (verificado en el catálogo de OpenRouter el 2026-09-14). Produce vectores de 1.536 dimensiones. Esa cifra sale de la documentación de OpenAI tal como la conozco; se verifica con una llamada real al implementar.

Se descartan los modelos de embeddings gratuitos de OpenRouter: al menos uno (Liquid LFM 2.5) declara que las peticiones pueden retenerse y usarse para entrenar.

## 5. Datos y persistencia

Tres conceptos nuevos, todos de la única configuración:
- **Entrada:** título, contenido y fechas.
- **Documento:** nombre original, huella del contenido (única, para detectar duplicados, FR-009), estado (`procesando`, `listo`, `no_se_pudo_leer`), motivo del error, texto extraído (para mostrarlo, FR-008) y fecha.
- **Pedazo:** pertenece a una entrada o a un documento (se borra en cascada con su origen); tiene la posición, el texto, el vector (vacío mientras está pendiente) y el modelo de embeddings con que se calculó.

- **Archivo original:** no se guarda. Después de extraer el texto se descarta (minimización, principio 4; la spec no pide descargarlo).
- **Extensión pgvector:** se activa en una migración (`create extension vector`). En local, la imagen de Docker pasa de `postgres:17` a `pgvector/pgvector:pg17` (existe, verificado 2026-09-14). En Supabase se activa la extensión (soportada según su documentación).
- **Índice vectorial:** ninguno. Con 20 documentos de hasta 4 MB son a lo sumo miles de pedazos, y una búsqueda exacta es suficiente. `ponytail:` se agrega un índice HNSW si la búsqueda se vuelve lenta.
- **Consistencia:** eliminar una entrada o un documento borra sus pedazos en la misma operación (FR-010). Editar una entrada reemplaza sus pedazos en una transacción.
- **Límite de 20 y duplicados:** se hacen cumplir en el servidor dentro de la transacción de alta. El duplicado lo impide también la restricción única de la huella.

## 6. Integraciones externas

**API de embeddings (OpenAI y OpenRouter).**
- **Qué viaja:** el texto de los pedazos y la API key configurada. Vuelven los vectores.
- **Formato:** `POST /v1/embeddings` compatible con OpenAI en ambos. El endpoint de OpenRouter existe y responde 401 sin key (probado el 2026-09-14).
- **Lotes:** hasta 100 pedazos por llamada, con el timeout de 10 s actual. Se revisa si 10 s no alcanza para un lote.
- **Fallos:** si la key es inválida o el proveedor no está disponible, los pedazos quedan pendientes y se reintenta en la próxima ejecución del indexador. No cambia el estado visible del documento: sigue "listo", pero se muestra el aviso de indexación pendiente.
- **Costo:** cada documento consume saldo de la key al indexarse, y cada pregunta al buscar (003). Es un riesgo aceptado (principio 11).

**Librerías nuevas (aprobadas por el usuario el 2026-09-14):**
- `unpdf` 1.8.1: sin dependencias, MIT.
- `mammoth` 1.12.3: BSD-2.
- Se descartó `pdf-parse`, que requiere un módulo nativo de canvas.

## 7. Seguridad y privacidad

- **Archivos no confiables (principio 3):**
  - Se valida la firma real (`%PDF` para PDF, zip para .docx) además de la extensión.
  - Tamaño ≤ 4 MB antes de procesar (`serverActions.bodySizeLimit` a 4,5 MB).
  - Texto extraído limitado (se rechaza por encima de 2.000.000 de caracteres).
  - Nunca se ejecuta nada del archivo.
- **.docx como zip:** un zip malicioso puede descomprimirse a algo enorme. Mitigación: el límite de texto extraído y la memoria de la función. Es un riesgo aceptado para un proyecto de aprendizaje sin login (ver §13).
- **Instrucciones escondidas en documentos:** un documento puede decir "ignora tus reglas". Aquí no tiene efecto porque esta feature no conversa. En la 003 los pedazos se tratan como información, no como instrucciones, y las reglas fijas prevalecen.
- **Datos personales:** aviso en pantalla (FR-013). El contenido de los pedazos se envía al proveedor de embeddings.
- **Logs:** nunca el contenido de los documentos ni la key. Solo el id del documento, el tipo de error y el proveedor.
- **Sin autenticación:** cualquiera puede cargar o borrar información y gastar saldo de la key indexando (principio 11, aceptado).

## 8. Modos de fallo y casos borde

| Situación | Comportamiento |
|---|---|
| Tipo no permitido, firma no coincide o más de 4 MB | Rechazo con el motivo; no se guarda nada |
| Ya hay 20 documentos | Rechazo con el motivo |
| Archivo idéntico (misma huella) | Aviso; no se duplica |
| PDF escaneado o archivo dañado o protegido | "no se pudo leer" con el motivo |
| El servidor se cae con un documento en "procesando" | Al leer la lista, un "procesando" de más de 5 minutos se muestra como "no se pudo leer: vuelve a subirlo" |
| Configuración incompleta | Documentos y entradas llegan a "listo"; los pedazos quedan pendientes y se muestra el aviso |
| Key inválida o proveedor caído al indexar | Pedazos pendientes; reintento automático en la próxima ejecución |
| Cambio de proveedor | El modelo de embeddings es el mismo, así que no se reindexa. Si algún día cambia, el indexador recalcula los pedazos con otro modelo |
| Se elimina un documento mientras se indexa | Sus pedazos se borran en cascada; el indexador ignora lo que ya no existe |
| Dos personas editan la misma entrada | Gana el último guardado |

## 9. Estrategia de pruebas

| Qué | Tipo |
|---|---|
| Reglas del servicio: entradas vacías o con espacios, tipos, 4 MB, límite de 20, duplicados, estados, "procesando" vencido (HU-1, HU-2, FR-002…FR-010, SC-004) | Unitarias, con extractor e indexador falsos |
| Extractor con archivos de prueba reales: PDF con texto, PDF escaneado, .docx, .txt y archivo con firma falsa (SC-002, SC-003) | Unitarias con fixtures |
| Partidor: tamaño, solapamiento, encabezado y texto corto | Unitarias |
| Indexador: solo pendientes, lotes, idempotente, reintento tras fallo, modelo distinto | Unitarias con proveedor falso |
| `embed` de cada proveedor: formato de la petición y traducción de errores | Unitarias con respuestas grabadas (como en la 001) |
| Guardar pedazos con vector, borrado en cascada, restricción de huella única, búsqueda por similitud coseno | Integración contra PostgreSQL con pgvector |
| Flujo completo en la pantalla y SC-001, SC-005, SC-006 | Manual |

## 10. Observabilidad

Logs del servidor: fallos de extracción (id del documento y motivo), fallos de indexación (proveedor y tipo de error) y cuántos pedazos se indexaron por ejecución. Sin métricas.

## 11. Despliegue y migración

- **Migración nueva:** activa `vector` y crea las tablas de entradas, documentos y pedazos.
- **`docker-compose.yml`:** la imagen pasa a `pgvector/pgvector:pg17`. Reutiliza el volumen; es la misma versión mayor de PostgreSQL, así que los datos se conservan.
- **Producción:** activar pgvector en Supabase antes de aplicar la migración.
- **`next.config.ts`:** `serverActions.bodySizeLimit: '4.5mb'`.

## 12. Decisiones y alternativas

| Decisión | Alternativas | Razón |
|---|---|---|
| RAG con embeddings | Enviar toda la base en cada pregunta (recomendada inicialmente por ser más simple) | Decisión del usuario: el objetivo del proyecto es aprender RAG y embeddings |
| Límite de 4 MB por documento | 10 MB con subida directa a Supabase Storage | Vercel limita las peticiones a 4,5 MB (documentación de Vercel). Decisión del usuario |
| pgvector en la misma base | Base vectorial externa | Mismo motor en local y producción, sin servicio nuevo. Supabase lo soporta |
| `text-embedding-3-small` fijo, vía el proveedor configurado | Modelo elegible por el usuario; modelo local; modelos gratuitos de OpenRouter | Disponible en ambos proveedores con el mismo nombre de modelo, así que cambiar de proveedor no obliga a reindexar. Los gratuitos pueden retener datos para entrenar |
| Documento "listo" al extraer; vectores aparte (pendientes) | "procesando" hasta tener vectores | Cumple FR-012 (cargar sin key) sin mentir sobre lo que se ve. El aviso de pendientes muestra la diferencia |
| Indexador idempotente de pendientes, lanzado en varios momentos | Cola de trabajos | No hace falta infraestructura de colas para este volumen |
| No guardar el archivo original | Guardarlo en la base o en un almacenamiento | La spec no pide descargarlo; minimización |
| Pedazos de ~1.000 caracteres con ~150 de solapamiento | Por página, por oración o semánticos | Punto de partida común y fácil de entender. Se ajusta en la 003 al ver resultados |
| Sin índice vectorial | HNSW o IVFFlat | Volumen pequeño; la búsqueda exacta basta |

## 13. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La búsqueda trae pedazos equivocados y el bot dice "no sé" teniendo la información | Derivaciones innecesarias (003/004) | Encabezado de título en cada pedazo; ajustar el tamaño y la cantidad de pedazos al probar la 003 |
| Zip malicioso en un .docx | Memoria agotada en esa petición | Límite de 4 MB y de texto extraído; riesgo aceptado (sin login, aprendizaje) |
| OpenRouter o OpenAI cambian o retiran `text-embedding-3-small` | La indexación falla | Los pedazos quedan pendientes y se ve el aviso; cambiar el nombre del modelo fuerza a reindexar |
| Gasto de saldo por indexar | Costo en la cuenta del proveedor | Principio 11 aceptado; se recomienda un límite de gasto en la cuenta |
| La imagen de Docker cambia en local | El volumen actual debe seguir sirviendo | Misma versión mayor (17); se verifica al implementar |

## 14. Preguntas técnicas abiertas

Ninguna que bloquee. Se verifica al implementar: las 1.536 dimensiones de `text-embedding-3-small`, con una llamada real, y que 10 s de timeout alcanzan para un lote de 100 pedazos.
