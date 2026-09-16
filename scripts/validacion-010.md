# Validación 010 — Mensajes multimedia

- **Fecha:** 2026-09-16
- **Resultado:** 31 de 31 comprobaciones
- **Saldo gastado:** ninguno. Un adjunto deriva por código antes de llamar al proveedor (FR-015), así que este guion no hace ninguna llamada al modelo.
- **Cómo se corrió:** `npx tsx scripts/validacion-010.mts` con el servidor de desarrollo levantado. Los archivos de muestra (PNG, WAV y PDF reales) se construyen dentro del guion.

## SC-001 — 15 de 15

| Caso | Esperado | Obtenido | |
|---|---|---|---|
| recibo.png: queda la ficha | imagen/70 | imagen/70 | ✅ |
| recibo.png: la ruta devuelve los bytes | 200/iguales | 200/iguales | ✅ |
| recibo.png: tipo que impone el servidor | image/png | image/png | ✅ |
| recibo.png: se muestra o se descarga | inline | inline | ✅ |
| recibo.png: nosniff | nosniff | nosniff | ✅ |
| nota.wav: queda la ficha | audio/244 | audio/244 | ✅ |
| nota.wav: la ruta devuelve los bytes | 200/iguales | 200/iguales | ✅ |
| nota.wav: tipo que impone el servidor | audio/wav | audio/wav | ✅ |
| nota.wav: se muestra o se descarga | inline | inline | ✅ |
| nota.wav: nosniff | nosniff | nosniff | ✅ |
| factura.pdf: queda la ficha | documento/193 | documento/193 | ✅ |
| factura.pdf: la ruta devuelve los bytes | 200/iguales | 200/iguales | ✅ |
| factura.pdf: tipo que impone el servidor | application/pdf | application/pdf | ✅ |
| factura.pdf: se muestra o se descarga | attachment | attachment | ✅ |
| factura.pdf: nosniff | nosniff | nosniff | ✅ |

## SC-002 — 2 de 2

| Caso | Esperado | Obtenido | |
|---|---|---|---|
| la respuesta del equipo se guarda | true | true | ✅ |
| el cliente la ve con su archivo | nota-credito.pdf | nota-credito.pdf | ✅ |

## SC-003 — 5 de 5

| Caso | Esperado | Obtenido | |
|---|---|---|---|
| la conversación pasa a modo humano | humano | humano | ✅ |
| queda la nota del bot con el archivo | sí | sí | ✅ |
| el motivo queda registrado | adjunto | adjunto | ✅ |
| el cliente ve un aviso, no una invención | sí | sí | ✅ |
| no se llamó al proveedor (FR-015) | sí | sí | ✅ |

## SC-004 — 6 de 6

| Caso | Esperado | Obtenido | |
|---|---|---|---|
| rechaza SVG (puede llevar script) | rechazado | rechazado | ✅ |
| rechaza vídeo (fuera de alcance) | rechazado | rechazado | ✅ |
| rechaza PNG renombrado a .pdf | rechazado | rechazado | ✅ |
| rechaza ejecutable renombrado a .png | rechazado | rechazado | ✅ |
| rechaza más de 4 MB | rechazado | rechazado | ✅ |
| acepta justo en el límite | aceptado | aceptado | ✅ |

## SC-005 — 3 de 3

| Caso | Esperado | Obtenido | |
|---|---|---|---|
| antes de borrar el archivo se sirve | 200 | 200 | ✅ |
| después de borrar ya no existe | 404 | 404 | ✅ |
| el adjunto se borra en cascada | 0 | 0 | ✅ |

## Comprobado a mano en el navegador (2026-09-16)

Lo que este guion no puede ver, hecho con el navegador contra el servidor de desarrollo:

| Caso | Resultado |
|---|---|
| El clip aparece a la izquierda del campo, del tamaño del botón de enviar | ✅ |
| Al elegir un archivo sale el chip con miniatura, nombre, peso y ✕ | ✅ |
| Con archivo y **sin texto**, el botón de enviar se activa (FR-001) | ✅ |
| Al enviarlo, la imagen se ve en el hilo y el chip desaparece | ✅ |
| El equipo ve esa misma imagen en el detalle de la conversación | ✅ |
| La barra de respuesta del equipo tiene su clip, solo activo en modo humano | ✅ |

### Defecto previo encontrado durante esta validación

El detalle de una conversación **no cargaba nada** si la pestaña no estaba visible: la primera consulta
estaba condicionada a `document.visibilityState === "visible"`, así que abrirlo en segundo plano dejaba
la línea de tiempo vacía y el modo mal (decía «Responde la IA» aunque la conversación estuviera en modo
humano). Se reprodujo con `visibilityState === "hidden"`.

No lo introdujo la feature 010: viene de KAN-31 (#25), de la 004. El chat ya tenía este mismo arreglo
desde KAN-32, con su comentario; nunca se aplicó al detalle. Corregido aquí porque impedía validar el
lado del equipo.

## Limpieza

Se borraron 5 de las 6 conversaciones creadas. Las que no se borran son las que quedaron en modo humano esperando respuesta: la 004 no deja borrar una conversación pendiente.
