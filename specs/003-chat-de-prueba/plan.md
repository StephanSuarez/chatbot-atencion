# Plan técnico — 003 Chat de prueba

- **Estado:** Approved (2026-09-15)
- **Fecha:** 2026-09-15
- **Spec:** `specs/003-chat-de-prueba/spec.md` (Approved)

## 1. Contexto

Una pestaña «Probar» para conversar con el bot. Cada mensaje recorre el RAG completo: la pregunta se convierte en vector, se buscan los pedazos más parecidos en la base de conocimiento (002) y se le entregan al modelo junto con el prompt y las reglas fijas. Debajo de cada respuesta, «Ver en qué se basó» muestra esos pedazos.

Restricciones que guían el diseño:
- **No inventar (principio 8):** el bot responde solo con la información encontrada.
- **Reglas fijas (principios 9 y 10):** prevalecen sobre el prompt y sobre el usuario.
- **Conversaciones sin guardar (FR-003):** no se persisten.
- **Sin login (principio 11):** cada mensaje gasta saldo de la key configurada.

## 2. Estado actual

- **Registro de proveedores** (`lib/providers/`): OpenAI y OpenRouter con `verifyKey`, `listChatModels` y `embed`, sobre un `request()` común. Traduce errores a `invalid_key` o `unavailable`, con timeout de 10 s y logs sin la key.
- **Configuración** (`lib/config-service.ts`): nombre, prompt (con `{nombre de la empresa}`), proveedor, modelo y key cifrada. Ofrece `getLlmCredentials()` (proveedor y key descifrada) y los textos `DEFAULT_PROMPT` y `FIXED_RULES`.
- **Base de conocimiento** (`lib/kb/`): pedazos con encabezado de origen y vector de 1.536 dimensiones (`text-embedding-3-small`), en PostgreSQL con pgvector. La búsqueda por coseno ya se probó en integración. `indexPending()` calcula lo que falta.
- **Pantallas**: pestañas (`app/tabs.tsx`), server actions que validan la entrada y vistas cliente que reutilizan `config.module.css`.
- **Pruebas**: Vitest con proveedor falso y base de tests en serie.

## 3. Arquitectura propuesta

```
Pestaña «Probar» (cliente: guarda la conversación en memoria)
   │ server action: enviar(historial reciente, mensaje)
   ▼
Servicio de chat ── valida, arma la respuesta, traduce errores
   │         │                 │
   │         ▼                 ▼
   │    Buscador ──► embed(pregunta) ──► pgvector: pedazos más parecidos
   │         (registro de proveedores)      (base de conocimiento 002)
   ▼
Armador del prompt: reglas fijas + empresa + prompt + información encontrada + historial
   │
   ▼
Registro de proveedores: chat(mensajes, modelo, key) ──► API del proveedor
   │
   ▼
Respuesta + pedazos usados (para «Ver en qué se basó»)
```

**Flujo de un mensaje:**
1. El cliente envía el mensaje nuevo y los últimos mensajes de la conversación, que viven solo en el navegador (FR-003).
2. El servidor valida: configuración completa (FR-011), texto de 1 a 1.000 caracteres (FR-004) y un historial con forma válida y limitado.
3. Si hay pedazos pendientes, corre `indexPending()` (la red de seguridad prevista en el plan 002).
4. **Buscar:** convierte en vector la pregunta junto con el mensaje anterior del usuario, para que «¿y los sábados?» siga el tema. Trae los 5 pedazos más parecidos por encima de un parecido mínimo.
5. **Armar:** un mensaje de sistema con, en este orden, las reglas fijas, el nombre de la empresa, el prompt de comportamiento y la información encontrada, delimitada como datos. Después, el historial y el mensaje nuevo.
6. **Responder:** `chat()` con el modelo configurado. Devuelve el texto y los pedazos usados, con su origen y su parecido.

## 4. Componentes y responsabilidades

| Componente | Responsabilidad | No debe |
|---|---|---|
| **Pantalla «Probar»** | Conversación en memoria, «Nueva conversación», indicador de «escribiendo», un envío a la vez (FR-013), conservar el mensaje si falla (FR-012), «Ver en qué se basó», bloqueo con «qué falta» (FR-011), aviso de información pendiente | Guardar la conversación; ver la key |
| **Servicio de chat** | Orquesta: validar, indexar pendientes, buscar, armar, llamar al modelo, traducir errores a mensajes para la pantalla | Saber cómo habla cada proveedor ni cómo se busca en la base |
| **Buscador** | Pregunta → vector → los N pedazos más parecidos, con origen (título o nombre de documento) y parecido (1 − distancia coseno) | Decidir qué responde el bot |
| **Armador del prompt** | Función pura que combina las reglas fijas, la empresa (reemplaza `{nombre de la empresa}`), el prompt, la información y el historial. Delimita la información y el mensaje del usuario como datos | Llamar a servicios externos |
| **Registro de proveedores** (existe) | Nueva operación `chat(mensajes, modelo, key)` sobre `POST /v1/chat/completions`, compatible con OpenAI en ambos. Distingue nuevos tipos de error: sin saldo, modelo no disponible y tiempo agotado | Guardar datos |

El comportamiento central vive en el **armador del prompt**, que decide qué sabe y qué no puede hacer el bot, y en el **servicio de chat**. Son las piezas más probadas.

**Por qué el mensaje de sistema tiene ese orden:** las reglas fijas van primero y se repiten brevemente al final, recordando que prevalecen (FR-009). La información va entre delimitadores, con la indicación de que es contenido de referencia y no instrucciones. Si la información no alcanza para responder, el bot tiene que decir que no la tiene y que va a consultar (FR-007). Con eso se cubren los principios 8 a 10. No es una garantía absoluta; ver §13.

## 5. Datos y persistencia

- **No se guarda nada nuevo.** La conversación existe solo en el navegador (FR-003, principio 4). Recargar la página la borra.
- **Lectura:** la configuración (002 y 001) y los pedazos con vector.
- **Historial enviado al servidor:** los últimos 10 mensajes, con un límite total de caracteres. No es confiable: el servidor valida roles y largos. Alguien podría inventar mensajes del bot en su propio historial; solo afecta su propia conversación de prueba (principio 11).

## 6. Integraciones externas

**Chat con el LLM (OpenAI y OpenRouter).**
- **Llamada:** `POST /v1/chat/completions` con `model`, `messages` y `temperature` baja (0,2), para respuestas más estables en los criterios de éxito.
- **Qué viaja:** el prompt armado (con la información de la empresa) y los últimos mensajes de la conversación.
- **Timeout:** 60 s para el chat, porque los modelos de razonamiento tardan más. El de verificación y embeddings sigue en 10 s. La función de Vercel dura por defecto 300 s (documentación de Vercel).
- **Errores**, traducidos a mensajes (FR-012):

| Situación | Cómo se reconoce (a verificar con respuestas reales al implementar) | Mensaje |
|---|---|---|
| Key inválida | 401 | «El proveedor rechazó la API key…» |
| Sin saldo | OpenRouter: 402; OpenAI: 429 con `insufficient_quota` | «Tu cuenta del proveedor no tiene saldo…» |
| Modelo no disponible | 404, o error que nombra el modelo | «El modelo … ya no está disponible. Elige otro en Tu chatbot» |
| Tiempo agotado o caído | timeout, red, 5xx, 429 por límite | «El proveedor no respondió. Reintenta» |

Los códigos de «sin saldo» y «modelo no disponible» salen de lo que conozco de ambas APIs; **no los verifiqué hoy**. Se confirman grabando respuestas reales, como se hizo en la 001.

**Embeddings de la pregunta**: la operación `embed` existente, con el mismo modelo que la base, así los vectores son comparables. Si falla, se trata como un error del proveedor más.

## 7. Seguridad y privacidad

- **Instrucciones escondidas** (en documentos cargados o en mensajes): la información va delimitada y rotulada como datos; las reglas fijas van primero y se repiten al final. Es una mitigación, no una garantía (§13).
- **Validación en el servidor:** largo del mensaje (≤ 1.000), historial (roles `user` o `assistant`, largo y cantidad) y configuración completa. La server action no confía en nada del cliente.
- **Key:** solo se descifra en el servidor; nunca viaja al navegador.
- **Logs:** nunca el contenido de los mensajes, de la información ni la key. Solo el tipo de error, el proveedor y los tiempos.
- **Datos personales:** no se guardan (FR-003). Lo que el usuario escribe viaja al proveedor (spec, restricciones externas).
- **Gasto de saldo:** cualquiera con acceso puede gastar la key (principio 11, aceptado). No hay límite de uso en esta feature.

## 8. Modos de fallo y casos borde

| Situación | Comportamiento |
|---|---|
| Configuración incompleta | La pantalla no deja escribir e indica qué falta (reutiliza `missing` de `getConfig`) |
| Base vacía o sin pedazos parecidos | El bot recibe «no hay información relacionada» y dice que no la tiene (FR-007); «Ver en qué se basó» indica que no encontró nada |
| Pedazos pendientes | Se indexan antes de buscar; si siguen pendientes (sin saldo, por ejemplo), se responde con lo disponible y la pantalla avisa |
| Proveedor falla | Mensaje según la tabla de §6; el mensaje del usuario vuelve al campo para reintentar |
| Mensaje vacío o de más de 1.000 caracteres | No se envía (cliente) y se rechaza (servidor) |
| Doble envío | El botón se bloquea mientras hay una respuesta en curso |
| Conversación larga | Solo se envían los últimos 10 mensajes (spec, supuesto aprobado) |
| Cambia la configuración mientras se prueba | Cada mensaje lee la configuración actual |

## 9. Estrategia de pruebas

| Qué | Tipo |
|---|---|
| Armador del prompt: orden, reglas primero y al final, reemplazo del nombre, información delimitada, caso sin información, recorte del historial (FR-005…FR-009) | Unitarias |
| Buscador: los más parecidos primero, parecido mínimo, origen correcto, solo pedazos con vector (FR-006, FR-010) | Integración contra pgvector con vectores construidos |
| Servicio de chat: configuración incompleta, validaciones, indexar pendientes antes, errores traducidos, pedazos devueltos (FR-004, FR-011, FR-012) | Unitarias con proveedor falso |
| `chat()` de cada proveedor: formato de la petición y traducción de 401, 402, 404, `insufficient_quota`, 5xx y timeout | Unitarias con respuestas grabadas |
| SC-001…SC-003: 10 preguntas con respuesta, 10 sin respuesta y 5 fuera de alcance sobre el Café Aurora | Manual, con un script que envía las 25 preguntas y deja las respuestas y los pedazos en un informe para que una persona los califique |
| Pantalla, SC-004…SC-007 | Manual en el navegador |

## 10. Observabilidad

Logs del servidor por mensaje: proveedor, modelo, cantidad de pedazos encontrados, mejor parecido, tiempos de búsqueda y de respuesta, y tipo de error si lo hubo. Sin el contenido del mensaje ni de la respuesta.

## 11. Despliegue y migración

Sin migraciones ni variables de entorno nuevas. Si en Vercel el modelo tarda más que la duración por defecto, se configura `maxDuration` en la ruta.

## 12. Decisiones y alternativas

| Decisión | Alternativas | Razón |
|---|---|---|
| Respuesta completa, con indicador de «escribiendo» | Mostrarla de a poco (streaming) | Decisión del usuario (2026-09-15). Más simple: una server action, sin procesar streams. Se puede agregar después sin cambiar el resto |
| Conversación solo en el navegador; el cliente envía el historial reciente | Guardarla en la base | FR-003 y minimización de datos. Guardarla es parte de la 004 |
| Buscar con la pregunta y el mensaje anterior del usuario | Solo la pregunta; reescribir la pregunta con el LLM | Resuelve preguntas de seguimiento sin una llamada extra al modelo |
| 5 pedazos y un parecido mínimo, como constantes | Configurables en la pantalla | Valores iniciales comunes; se ajustan con la prueba de 25 preguntas. Nadie más necesita cambiarlos |
| `chat()` en el registro de proveedores existente | SDK de cada proveedor | Mismo patrón que `embed`: API compatible con OpenAI, sin dependencias nuevas |
| Temperatura 0,2 | Valor por defecto del proveedor | Respuestas más estables para cumplir SC-001 y SC-002 |
| Script de evaluación de 25 preguntas (manual) | Solo probar a mano; que un LLM califique | Deja evidencia repetible para SC-001…SC-003 y para ajustar la búsqueda; la calificación la hace una persona |

## 13. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La búsqueda no trae el pedazo correcto | El bot dice «no sé» teniendo la información (falla SC-001) | «Ver en qué se basó» lo muestra; ajustar el número de pedazos y el parecido mínimo con el script; las técnicas de §12 del plan 002 (recuperación contextual, búsqueda híbrida) si hace falta |
| El modelo inventa pese a las instrucciones | Falla SC-002 y el principio 8 | Temperatura baja, instrucciones explícitas y medición con 10 preguntas sin respuesta; si falla, probar con otro modelo antes de complicar el diseño |
| Instrucciones escondidas en documentos o mensajes | El bot se sale de sus reglas | Delimitación y reglas repetidas; riesgo aceptado para una prueba sin datos reales |
| Modelos gratuitos lentos o con límites | Respuestas lentas o errores 429 | Timeout de 60 s y mensaje de reintentar |
| Códigos de error distintos a los supuestos | Mensajes poco precisos (cae en «no respondió») | Grabar respuestas reales al implementar |

## 14. Preguntas técnicas abiertas

Ninguna que bloquee (respuesta completa, decidido el 2026-09-15). Al implementar se verifican los códigos reales de «sin saldo» y «modelo no disponible» en ambos proveedores, y el valor inicial del parecido mínimo con el Café Aurora.
