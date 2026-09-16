# 008 — Métricas de conversaciones

- **Estado:** Approved (2026-09-15)
- **Fecha:** 2026-09-15
- **Origen:** `roadmap.md`, feature 008

> Aprobada por delegación del usuario (2026-09-15). Las decisiones de producto van marcadas como *(decisión propia)*.

## Resumen

Ahora que todas las conversaciones se guardan (004), esta feature las convierte en números: cuántas atendió el bot solo, cuántas necesitaron a una persona, y qué preguntan más los clientes. Sirve para saber si el bot está sirviendo y para decidir qué información cargarle.

## Actores

- **Persona del equipo:** la misma que atiende las derivaciones y revisa lo que el bot aprende. No hay login ni roles (principio 11).

## Historias de usuario

### HU-1 — Ver si el chatbot está sirviendo (P1)

Como persona del equipo, quiero ver cuántas conversaciones resolvió el bot solo, para saber si vale la pena y si está mejorando.

- Dado que hay conversaciones guardadas, cuando abro las métricas, entonces veo cuántas hubo en total, cuántas resolvió el bot solo y cuántas necesitaron a una persona.
- Dado que elijo un periodo, cuando lo aplico, entonces los números corresponden solo a ese periodo.
- Dado que no hay conversaciones en ese periodo, cuando lo veo, entonces se indica que no hay datos, sin mostrar ceros confusos.

### HU-2 — Saber qué preguntan los clientes (P1)

Como persona del equipo, quiero ver las preguntas más frecuentes, para cargarle al bot la información que le falta.

- Dado que hay conversaciones, cuando abro las métricas, entonces veo los temas más preguntados por los clientes, con cuántas veces apareció cada uno.
- Dado que elijo un tema, cuando lo abro, entonces veo ejemplos reales de cómo lo preguntaron los clientes.
- Dado que un tema aparece sobre todo en conversaciones derivadas, cuando lo veo, entonces está señalado como algo que el bot no supo responder.

### HU-3 — Ver por qué deriva el bot (P2)

Como persona del equipo, quiero ver por qué motivo se derivan las conversaciones, para atacar la causa más común.

- Dado que hubo derivaciones, cuando abro las métricas, entonces veo cuántas fueron por no saber, por enojo y por pedido de una persona.

## Requisitos funcionales

- **FR-001:** Las métricas se ven en la plataforma, con un periodo seleccionable (hoy, últimos 7 días, últimos 30 días, todo).
- **FR-002:** Se muestran: conversaciones totales, resueltas por el bot (nunca derivadas), derivadas y pendientes de respuesta.
- **FR-003:** Se muestra el porcentaje de conversaciones que resolvió el bot solo.
- **FR-004:** Se muestran los temas más preguntados por los clientes, con su número de apariciones, calculados a partir de los mensajes de los clientes.
- **FR-005:** Cada tema puede abrirse para ver ejemplos reales de mensajes de clientes.
- **FR-006:** Un tema indica cuántas de sus conversaciones terminaron derivadas, para distinguir lo que el bot no supo responder.
- **FR-007:** Se muestra el desglose de derivaciones por motivo (no sabe, enojo, pidió una persona).
- **FR-008:** Calcular las métricas no llama al proveedor de LLM y no consume saldo. *(decisión propia)*
- **FR-009:** Sin datos en el periodo, se indica claramente en vez de mostrar ceros.

## Casos borde

- **Solo hay conversaciones de prueba:** se cuentan igual; el origen se muestra para saberlo. *(decisión propia)*
- **Una conversación sin mensajes del cliente** (por ejemplo, solo el saludo del bot): no aporta temas.
- **Mensajes muy cortos** («hola», «ok», «gracias»): no forman temas propios.
- **Muchas conversaciones:** las métricas siguen respondiendo en un tiempo razonable; los temas se calculan sobre los mensajes del periodo elegido.
- **Se borran conversaciones:** las métricas dejan de contarlas; no se guarda un histórico aparte. *(decisión propia)*

## Entidades clave

- **Resumen del periodo:** totales, resueltas por el bot, derivadas, pendientes y porcentaje de resolución.
- **Tema:** un grupo de mensajes de clientes que preguntan lo mismo, con su número de apariciones, ejemplos y cuántas derivaron.

## Criterios de éxito

- **SC-001:** Con 20 conversaciones conocidas, los totales y el desglose coinciden con lo que hay en «Conversaciones».
- **SC-002:** Los temas agrupan mensajes que preguntan lo mismo con palabras distintas al menos en la mitad de los casos revisados a mano.
- **SC-003:** Cambiar el periodo cambia los números de forma coherente.
- **SC-004:** Ver las métricas no genera ninguna llamada al proveedor de LLM.

## Restricciones externas

- **Ley 1581 de 2012:** los ejemplos de mensajes pueden contener datos personales; se muestran solo dentro de la plataforma, igual que las conversaciones.

## Fuera de alcance

- Exportar las métricas a archivo.
- Gráficas de evolución en el tiempo.
- Medir tiempos de respuesta del equipo.
- Medir satisfacción del cliente.
- Métricas por canal (hasta que exista WhatsApp, 007).

## Preguntas abiertas

Ninguna.

## Diferido al plan

- Cómo se agrupan los mensajes en temas.
- Dónde viven las métricas dentro de la plataforma.
