# Plan técnico — 008 Métricas de conversaciones

- **Estado:** Approved (2026-09-15)
- **Fecha:** 2026-09-15
- **Spec:** `specs/008-metricas-conversaciones/spec.md` (Approved)

> Aprobado por delegación del usuario (2026-09-15).

## 1. Contexto

Todas las conversaciones y sus mensajes ya están guardados (004). Esta feature solo lee y agrega: no escribe nada nuevo ni llama al proveedor (FR-008).

## 2. Estado actual

- **Conversaciones** (`lib/conversations/service.ts` + tablas `conversations` y `conversation_entries`): modo, si el bot la derivó, fecha del último mensaje, y la línea de tiempo con el autor de cada entrada.
- **Motivo de derivación:** hoy vive dentro del texto del evento («El bot pasó la conversación a modo humano (no tiene la información)»), no en una columna.
- **Pantalla «Conversaciones»** con filtros por fecha, que ya resuelven el rango.

## 3. Arquitectura propuesta

```
«Conversaciones» → pestaña interna «Métricas» (misma pantalla, otro modo de ver lo mismo)
        │ periodo (hoy / 7 días / 30 días / todo)
        ▼
Servicio de métricas ── SQL de agregación ──► resumen y desglose por motivo
        └─ temas: agrupación léxica de los mensajes de clientes (en memoria)
```

**Resumen** (FR-002, FR-003, FR-007): consultas SQL con `count` y `filter`, sin traer filas a memoria.

**Temas** (FR-004…FR-006): se traen los mensajes de clientes del periodo y se agrupan **por palabras clave**, no con el LLM:
1. Se normaliza cada mensaje (minúsculas, sin tildes ni signos).
2. Se quitan palabras vacías del español y saludos.
3. Se toma la firma del mensaje: sus palabras significativas ordenadas.
4. Dos mensajes caen en el mismo tema si comparten suficientes palabras significativas (coeficiente de Jaccard sobre un umbral).
5. El tema se nombra con el mensaje más representativo (el más corto del grupo grande).

**ponytail:** agrupación léxica, sin embeddings. Techo conocido: no une «¿tienen wifi?» con «¿hay internet?». Si se queda corta, el siguiente paso es reusar los embeddings de la 002 sobre los mensajes de clientes, lo que sí gastaría saldo.

## 4. Componentes y responsabilidades

| Componente | Responsabilidad | No debe |
|---|---|---|
| **Servicio de métricas** (nuevo, `lib/metrics/`) | Resumen del periodo, desglose por motivo y agrupación en temas | Escribir en la base ni llamar al proveedor |
| **Pantalla «Conversaciones»** (existe) | Un modo «Métricas» con el periodo, las tarjetas de resumen y la lista de temas | Calcular nada |

## 5. Datos y persistencia

Ninguna tabla nueva. Se lee de `conversations` y `conversation_entries`.

Para el desglose por motivo (FR-007) hace falta distinguirlos: hoy el motivo está dentro del texto del evento. Se añade la columna `handoff_reason` en `conversations` (migración `0005`), que el servicio de chat rellena al derivar. Las conversaciones anteriores quedan sin motivo y se cuentan aparte como «sin registrar».

## 6. Integraciones externas

Ninguna. Es el punto de la feature (FR-008, SC-004).

## 7. Seguridad y privacidad

- Los ejemplos de mensajes pueden traer datos personales: se muestran solo en la plataforma, como las conversaciones.
- Sin login (principio 11), quien entra ve las métricas.
- Consultas de solo lectura, con el periodo acotado.

## 8. Modos de fallo y casos borde

| Situación | Comportamiento |
|---|---|
| Periodo sin conversaciones | Se indica que no hay datos (FR-009) |
| Mensajes muy cortos o saludos | Se descartan antes de agrupar |
| Muchísimos mensajes | Se agrupan los del periodo; el trabajo pesado es SQL y el resto es una pasada en memoria |
| Conversaciones anteriores a la migración | Cuentan en los totales; su motivo aparece como «sin registrar» |

## 9. Estrategia de pruebas

| Qué | Tipo |
|---|---|
| Resumen: totales, resueltas, derivadas, pendientes y porcentaje | Integración con datos sembrados |
| Periodo: los números cambian al cambiar el rango | Integración |
| Temas: agrupa variantes de la misma pregunta, descarta saludos, cuenta derivadas | Unitarias con mensajes de ejemplo |
| Que no se llame al proveedor | Unitaria: el módulo no importa el registro de proveedores |
| Pantalla | Manual en el navegador |

## 10. Observabilidad

Nada nuevo: son lecturas.

## 11. Despliegue y migración

Migración `0005`: columna `handoff_reason` en `conversations`, opcional.

## 12. Decisiones y alternativas

| Decisión | Alternativas | Razón |
|---|---|---|
| **Agrupación léxica, sin LLM** | Embeddings de los mensajes; pedirle al modelo que agrupe | FR-008: ver métricas no puede costar dinero. El techo queda anotado |
| **Modo dentro de «Conversaciones»** | Pestaña nueva | Son los mismos datos vistos de otra forma; una quinta pestaña recarga la barra |
| **Columna para el motivo** | Leer el texto del evento con expresiones regulares | Un dato que se consulta no debe vivir dentro de una frase |
| **Sin histórico propio** | Guardar recuentos por día | Borrar una conversación debe borrarla de las métricas (principio 4) |

## 13. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Los temas agrupan mal | La lista sirve poco | Umbral ajustable y ejemplos visibles para juzgarlo; el techo está anotado |
| Muchas conversaciones hacen lenta la agrupación | Pantalla lenta | Se agrupa solo el periodo elegido; si crece, se limita el número de mensajes |
| Conversaciones viejas sin motivo | Desglose incompleto al principio | Se cuentan como «sin registrar», sin inventar |

## 14. Preguntas técnicas abiertas

Ninguna.
