# Plan técnico — 001 Configuración del chatbot

- **Estado:** Approved (2026-09-14)
- **Fecha:** 2026-09-14
- **Spec:** `specs/001-configuracion-chatbot/spec.md` (Approved)

## 1. Contexto

Pantalla única para editar la configuración del único chatbot: nombre de la empresa, prompt de comportamiento (por defecto, máximo 4.000 caracteres) y conexión con el LLM (proveedor, modelo y API key).

Restricciones que guían el diseño:
- La API key se verifica con el proveedor antes de guardarla y nunca vuelve a salir completa del servidor (spec FR-007, FR-013; constitución, principio 11).
- Los proveedores son dinámicos: agregar uno no debe cambiar la spec (FR-006). Proveedores iniciales: **OpenAI** y **OpenRouter**.
- Sin login: riesgo aceptado (principio 11). Aun así, el servidor valida todo lo que recibe (principio 3).

## 2. Estado actual

Proyecto nuevo: no hay código ni arquitectura existente. Este plan define la base mínima.

## 3. Arquitectura propuesta

Monolito Next.js: interfaz y servidor en el mismo proyecto. PostgreSQL local en desarrollo; Supabase (usado como PostgreSQL) y Vercel en producción.

```
Navegador (pantalla de configuración)
   │  server actions
   ▼
Servicio de configuración  ── reglas de la spec (validación, verificación, enmascarado)
   │                 │
   ▼                 ▼
Repositorio      Registro de proveedores ──► API del proveedor de LLM
(PostgreSQL)     (verificar key, listar modelos)
   │
Cifrado (clave maestra en variable de entorno)
```

Flujo principal (guardar):
1. La persona elige un proveedor e ingresa la key. Pulsa "cargar modelos": el servidor verifica la key con el proveedor y le pide la lista de modelos.
2. Elige el modelo, edita el nombre y el prompt, y guarda.
3. El servidor valida los campos. Si hay una key nueva, **vuelve a verificarla** (el navegador no es confiable) y comprueba que el modelo esté en la lista del proveedor. Si algo falla, no guarda nada.
4. Cifra la key, guarda la configuración y devuelve la vista pública (con la key enmascarada).

Si ya hay una key guardada y solo se cambia el modelo, el servidor descifra la key internamente para pedir la lista de modelos. La key nunca viaja al navegador.

## 4. Componentes y responsabilidades

| Componente | Responsabilidad | No debe |
|---|---|---|
| **Pantalla de configuración** | Formulario, "cargar modelos", "restaurar prompt por defecto" (con confirmación), aviso de cambios sin guardar, estado completa/incompleta, reglas fijas visibles | Tener reglas de negocio propias más allá de ayudas de UX; ver la key completa |
| **Servicio de configuración** | Todas las reglas de la spec: validación (nombre, prompt ≤ 4.000, proveedor existente, modelo válido), key nueva o conservada, cambio de proveedor exige key nueva, verificación antes de guardar, cálculo de "completa", vista pública enmascarada | Saber cómo habla cada proveedor ni cómo se guarda en la base |
| **Registro de proveedores** | Lista de proveedores disponibles (OpenAI, OpenRouter). Cada proveedor implementa dos operaciones: verificar una key y listar sus modelos de chat. Ambas traducen los errores del proveedor a errores de la plataforma (key inválida / proveedor no disponible) | Guardar datos; conocer la configuración |
| **Cifrado** | Cifrar y descifrar la key con la clave maestra de la variable de entorno | Decidir cuándo se descifra |
| **Repositorio** | Leer y guardar la única fila de configuración | Validar reglas |

El comportamiento central vive en el **servicio de configuración**. Es lo que se prueba más a fondo.

Textos fijos en código: el prompt por defecto aprobado y las reglas fijas (principios 8–10), que la pantalla solo muestra. Combinarlos con el prompt al hablar con el LLM es trabajo de la 003.

## 5. Datos y persistencia

Una tabla con **una sola fila**, garantizada por una restricción de la base de datos (no por código):
- nombre de la empresa, prompt;
- proveedor, modelo;
- key cifrada (con los datos necesarios para descifrarla) y sus **últimos 4 caracteres en claro**, para mostrar el enmascarado sin descifrar;
- fecha de última actualización.

- **Ciclo de vida:** si la fila no existe, se muestran los valores iniciales (nombre vacío, prompt por defecto, sin LLM). La fila se crea con el primer guardado.
- **Consistencia:** cada guardado reemplaza la fila completa en una sola operación; si dos personas guardan a la vez, gana la última (FR-012).
- **Datos sensibles:** solo la key. No hay datos personales de clientes (Ley 1581 no aplica a esta feature).
- **Migraciones:** versionadas en el repositorio y aplicadas igual en local y en Supabase.
- **Acceso a la base:** Drizzle ORM (esquema tipado y migraciones). Se usa Supabase solo como PostgreSQL, sin su SDK: el mismo código funciona en ambos entornos cambiando `DATABASE_URL`.
- **Conexión a Supabase:** los detalles (pooler, cadenas de conexión) se resuelven al desplegar.

## 6. Integraciones externas

**Proveedores de LLM: OpenAI y OpenRouter.** En esta feature no se conversa con el LLM; solo se verifica la key y se listan modelos.

Comportamiento comprobado el 2026-09-14 con llamadas reales a las APIs (sin keys válidas):

| | OpenAI | OpenRouter |
|---|---|---|
| Listar modelos | `GET /v1/models`, **exige key** | `GET /api/v1/models`, **público**: responde 200 sin key y con una key falsa |
| Verificar key | La misma llamada de listar (401 `invalid_api_key` si es inválida) | Llamada aparte: `GET /api/v1/key` (401 si es inválida) |
| Filtrar modelos de chat | La respuesta no indica capacidades (según lo que se conoce del formato; no se pudo leer la doc oficial). Se filtra por nombre de modelo, excluyendo embeddings, audio, imagen y moderación | Cada modelo trae `architecture.output_modalities`; se muestran los que incluyen `text` |

- **Qué viaja:** la key hacia el proveedor; la lista de modelos de vuelta.
- **Autenticación:** la API key de la configuración (encabezado `Authorization: Bearer`).
- **Fallos:** 401 → "key inválida"; timeout, error de red o 5xx → "no se pudo verificar, reintenta". En ambos casos no se guarda nada.
- **Timeout:** 10 segundos por llamada.
- **Tamaño de la lista:** OpenRouter devolvió 445 modelos el 2026-09-14; el selector de modelo necesita búsqueda por texto.

**PostgreSQL / Supabase.**
- En producción, Vercel ejecuta el servidor como funciones efímeras, así que se usa la conexión con pooler de Supabase. Esto se verifica al desplegar.

## 7. Seguridad y privacidad

- **Key cifrada en reposo** con cifrado autenticado (AES-256-GCM, de la librería estándar de Node). La clave maestra está en la variable de entorno `ENCRYPTION_KEY`, nunca en el repositorio. `.env*` va en `.gitignore`.
- **La key nunca sale completa del servidor:** el servicio solo devuelve una vista pública con los últimos 4 caracteres. El descifrado ocurre solo dentro del servidor, para llamar al proveedor.
- **Validación en el servidor** de todo lo que llega del navegador (nombre, largo del prompt, proveedor dentro del registro, modelo dentro de la lista real). A la key se le quitan los espacios.
- **Logs:** nunca se registran la key ni la clave maestra. Los errores del proveedor se registran solo con el nombre del proveedor y el tipo de error.
- **Sin autenticación:** riesgo aceptado (principio 11). Cualquiera puede cambiar la configuración o hacer que se verifiquen keys. No hay controles adicionales en esta feature.

## 8. Modos de fallo y casos borde

| Situación | Comportamiento |
|---|---|
| Key inválida | Mensaje "key inválida"; no se guarda nada |
| Proveedor caído o timeout | Mensaje "no se pudo verificar, reintenta"; no se guarda nada |
| Modelo no presente en la lista del proveedor | Error de validación; no se guarda nada |
| Cambio de proveedor sin key nueva | Error de validación; no se guarda nada |
| Base de datos no disponible | Mensaje de error genérico; no se muestra la confirmación |
| Falta `ENCRYPTION_KEY` o tiene un formato inválido | La app no arranca (falla visible al iniciar) |
| `ENCRYPTION_KEY` cambia o se pierde | La key guardada ya no se puede descifrar: la configuración se muestra como incompleta ("vuelve a ingresar la key") |
| Dos guardados simultáneos | Gana el último |
| Guardar dos veces igual | Mismo resultado (reemplazo completo de la fila) |
| Salir con cambios sin guardar | Aviso del navegador antes de salir |

## 9. Estrategia de pruebas

| Qué | Tipo |
|---|---|
| Reglas del servicio (nombre vacío o con espacios, prompt de más de 4.000, cambio de proveedor exige key, conservar o reemplazar key, no guardar si falla la verificación, "completa") — HU-1, HU-2, FR-002/008/009/010/013/014/015, SC-003, SC-006 | Unitarias, con un proveedor falso |
| Cifrado de ida y vuelta; enmascarado de los últimos 4 caracteres; la vista pública no contiene la key — FR-007, SC-002 | Unitarias |
| Guardar y leer contra PostgreSQL local; restricción de fila única — FR-001, FR-011, SC-004 | Integración |
| Traducción de errores de cada proveedor real | Unitarias con respuestas grabadas del proveedor |
| Flujo completo con una key real, restaurar prompt, aviso de cambios sin guardar, tiempo de configuración — SC-001, SC-005, HU-3, HU-4 | Manual |

Herramienta: Vitest. No se usan pruebas end-to-end automatizadas en esta feature; la UI se valida a mano.

## 10. Observabilidad

Solo logs del servidor: fallos de verificación (proveedor y tipo de error) y errores de la base de datos. Sin métricas.

## 11. Despliegue y migración

- **Local:** PostgreSQL en Docker (un `docker-compose.yml` con un solo servicio, con la misma versión mayor de PostgreSQL que use Supabase; se verifica al implementar) y un `.env.local` con `DATABASE_URL` y `ENCRYPTION_KEY`.
- **Producción (más adelante):** Vercel + Supabase, con `DATABASE_URL` (pooler) y `ENCRYPTION_KEY` en las variables de entorno de Vercel. Las migraciones se aplican a Supabase antes de desplegar.
- **La `ENCRYPTION_KEY` de producción es distinta a la local:** las keys guardadas en local no se migran; en producción se vuelven a ingresar.

## 12. Decisiones y alternativas

| Decisión | Alternativas | Razón |
|---|---|---|
| Monolito Next.js | Python + HTML; frontend y backend separados | Decisión del usuario. Un proyecto y un lenguaje; Vercel lo despliega de forma nativa |
| PostgreSQL desde el inicio (local → Supabase) | JSON; SQLite | Decisión del usuario: el mismo motor en local y en producción, sin migrar después |
| Supabase como PostgreSQL simple, sin su SDK | SDK de Supabase | Mismo código en local y en producción; no se necesita autenticación ni tiempo real de Supabase |
| Drizzle ORM | Prisma; SQL a mano + driver | Decisión del usuario (se evaluó Prisma y se descartó por más fricción). Esquema tipado y migraciones versionadas con poca maquinaria |
| Key cifrada con AES-256-GCM y clave en variable de entorno | Texto plano | Decisión del usuario; librería estándar, sin dependencias nuevas |
| Últimos 4 caracteres guardados aparte | Descifrar para enmascarar | Mostrar la configuración nunca requiere descifrar |
| Registro de proveedores con dos operaciones (listar modelos y traducir errores) | Llamar al SDK de cada proveedor desde todo el código; un framework multi-proveedor | La spec exige varios proveedores: la variación es real. Dos operaciones es lo mínimo que la cubre |
| Los modelos se piden al proveedor; la verificación es una operación aparte por proveedor | Asumir que listar modelos verifica la key | Decisión del usuario (lista siempre al día). Separar la verificación es necesario: en OpenRouter la lista de modelos es pública y no verifica nada |
| Filtro de modelos de chat de OpenAI por nombre | Mostrar todos los modelos | La API no expone capacidades; mostrar embeddings o TTS confundiría. Se revisa si OpenAI saca familias nuevas |
| El servidor vuelve a verificar la key al guardar | Confiar en la verificación que hizo el navegador | El navegador no es confiable (principio 3); garantiza SC-006 |
| "Restaurar prompt por defecto" solo rellena el campo; se aplica al guardar | Guardar al restaurar | Coherente con "guardar" y con el aviso de cambios sin guardar |

## 13. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Se pierde la `ENCRYPTION_KEY` | Hay que volver a ingresar la key | Aceptable: basta con volver a ingresarla; documentado |
| Uso no autorizado de la key (sin login) | Gasto en la cuenta del proveedor | Riesgo aceptado (principio 11); se recomienda poner un límite de gasto en la cuenta del proveedor |
| El filtro por nombre de OpenAI deja pasar o excluye un modelo por error | Aparece un modelo que no es de chat, o falta uno | Prueba unitaria con una respuesta grabada; ajustar la lista de exclusión cuando aparezcan familias nuevas |
| Conexiones a Supabase desde Vercel | Errores de conexión en producción | Se resuelve al desplegar |

## 14. Preguntas técnicas abiertas

Ninguna. Para la prueba manual hace falta una key real de OpenAI y otra de OpenRouter.
