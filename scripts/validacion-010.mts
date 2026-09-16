// Validación de los mensajes multimedia (spec 010, SC-001…SC-005).
//
// NO gasta saldo: un adjunto deriva por código antes de llamar al proveedor (FR-015), así que en todo
// este guion no se hace ni una llamada al modelo. Necesita el servidor de desarrollo levantado, porque
// comprueba la ruta que sirve los archivos de verdad, por HTTP.
//
//   npm run dev            (en otra terminal)
//   npx tsx scripts/validacion-010.mts
//
// Deja el informe en scripts/validacion-010.md. Las conversaciones que crea se borran al final, salvo la
// del caso que comprueba justamente el borrado.

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

process.loadEnvFile(".env.local");

const { saveClientMessage, getEntries, deleteConversation, setMode, saveTeamReply } = await import(
  "../lib/conversations/service.ts"
);
const { sendMessage } = await import("../lib/chat/service.ts");
const { validateAttachment } = await import("../lib/attachments/validate.ts");
const { sql } = await import("../lib/db.ts");

const BASE = "http://localhost:3000";

// ---------- Archivos de muestra, construidos aquí para no meter binarios en el repo ----------

/** PNG real de 1×1 píxel. */
const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** WAV real: cabecera RIFF/WAVE con un puñado de muestras en silencio. */
function wav(): Uint8Array {
  const muestras = 100;
  const buffer = Buffer.alloc(44 + muestras * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + muestras * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(muestras * 2, 40);
  return new Uint8Array(buffer);
}

/** PDF real de una página, en texto plano. */
const PDF = new TextEncoder().encode(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`,
);

const MUESTRAS = [
  { nombre: "recibo.png", bytes: PNG, categoria: "imagen", tipo: "image/png" },
  { nombre: "nota.wav", bytes: wav(), categoria: "audio", tipo: "audio/wav" },
  { nombre: "factura.pdf", bytes: PDF, categoria: "documento", tipo: "application/pdf" },
] as const;

// ---------- Utilidades del informe ----------

interface Linea {
  criterio: string;
  caso: string;
  esperado: string;
  obtenido: string;
  ok: boolean;
}

const filas: Linea[] = [];
const anotar = (criterio: string, caso: string, esperado: string, obtenido: string) =>
  filas.push({ criterio, caso, esperado, obtenido, ok: esperado === obtenido });

const creadas: string[] = [];

async function guardar(nombre: string, bytes: Uint8Array, categoria: string, tipo: string, texto = "") {
  const guardado = await saveClientMessage({
    clientMessageId: randomUUID(),
    text: texto,
    attachment: { name: nombre, category: categoria as "imagen", contentType: tipo, data: new Uint8Array(bytes) },
  });
  creadas.push(guardado.conversationId);
  const entradas = (await getEntries(guardado.conversationId, { forClient: true })) ?? [];
  return { conversationId: guardado.conversationId, entrada: entradas[0] };
}

// ---------- SC-001: los tres tipos se guardan y se sirven ----------

console.info("SC-001: guardar y servir los tres tipos…");
for (const muestra of MUESTRAS) {
  const { entrada } = await guardar(muestra.nombre, muestra.bytes, muestra.categoria, muestra.tipo, "mira esto");
  const ficha = entrada?.attachment;

  anotar("SC-001", `${muestra.nombre}: queda la ficha`, `${muestra.categoria}/${muestra.bytes.length}`, `${ficha?.category}/${ficha?.sizeBytes}`);

  if (!ficha) continue;
  const respuesta = await fetch(`${BASE}/api/adjuntos/${ficha.id}`);
  const recibidos = new Uint8Array(await respuesta.arrayBuffer());
  const iguales = recibidos.length === muestra.bytes.length && recibidos.every((b, i) => b === muestra.bytes[i]);

  anotar("SC-001", `${muestra.nombre}: la ruta devuelve los bytes`, "200/iguales", `${respuesta.status}/${iguales ? "iguales" : "distintos"}`);
  anotar("SC-001", `${muestra.nombre}: tipo que impone el servidor`, muestra.tipo, respuesta.headers.get("content-type") ?? "(ninguno)");

  const disposicion = (respuesta.headers.get("content-disposition") ?? "").split(";")[0];
  anotar(
    "SC-001",
    `${muestra.nombre}: se muestra o se descarga`,
    muestra.categoria === "documento" ? "attachment" : "inline",
    disposicion,
  );
  anotar("SC-001", `${muestra.nombre}: nosniff`, "nosniff", respuesta.headers.get("x-content-type-options") ?? "(ninguno)");
}

// ---------- SC-003: un archivo deriva sin que el bot invente nada ----------

console.info("SC-003: derivación por archivo, sin llamar al proveedor…");
const empezado = Date.now();
const enviado = await sendMessage({
  clientMessageId: randomUUID(),
  message: "¿me cobraron de más?",
  attachment: { name: "factura.pdf", category: "documento", contentType: "application/pdf", data: new Uint8Array(PDF) },
});

if (enviado.ok) {
  creadas.push(enviado.conversationId);
  const todas = (await getEntries(enviado.conversationId, { forClient: false })) ?? [];
  const [fila] = await sql`select handoff_reason from conversations where id = ${enviado.conversationId}`;

  anotar("SC-003", "la conversación pasa a modo humano", "humano", enviado.mode);
  anotar("SC-003", "queda la nota del bot con el archivo", "sí", todas.some((e) => e.author === "nota" && e.text.includes("factura.pdf")) ? "sí" : "no");
  anotar("SC-003", "el motivo queda registrado", "adjunto", String(fila?.handoff_reason));
  anotar("SC-003", "el cliente ve un aviso, no una invención", "sí", enviado.entries.some((e) => e.author === "bot" && /revisar/i.test(e.text)) ? "sí" : "no");
  // Una llamada real al modelo no baja de cientos de milisegundos: esto es la prueba de que no se hizo.
  anotar("SC-003", "no se llamó al proveedor (FR-015)", "sí", Date.now() - empezado < 1500 ? "sí" : "no");
} else {
  anotar("SC-003", "enviar un archivo", "ok", `error: ${enviado.error}`);
}

// ---------- SC-002 (parte automatizable): el equipo responde con un archivo ----------

console.info("SC-002: respuesta del equipo con archivo…");
const conversacion = (await guardar("recibo.png", PNG, "imagen", "image/png", "hola")).conversationId;
await setMode(conversacion, "humano");
const respondido = await saveTeamReply(conversacion, "Aquí tienes la nota crédito", {
  name: "nota-credito.pdf",
  category: "documento",
  contentType: "application/pdf",
  data: new Uint8Array(PDF),
});
const delCliente = (await getEntries(conversacion, { forClient: true })) ?? [];
const delEquipo = delCliente.find((e) => e.author === "equipo");

anotar("SC-002", "la respuesta del equipo se guarda", "true", String(respondido));
anotar("SC-002", "el cliente la ve con su archivo", "nota-credito.pdf", delEquipo?.attachment?.name ?? "(sin adjunto)");

// ---------- SC-004: lo que no se acepta ----------

console.info("SC-004: rechazos…");
const rechazos = [
  ["SVG (puede llevar script)", "icono.svg", new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")],
  ["vídeo (fuera de alcance)", "clip.mp4", new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70])],
  ["PNG renombrado a .pdf", "disfrazado.pdf", PNG],
  ["ejecutable renombrado a .png", "malo.png", new Uint8Array([0x4d, 0x5a, 0x90, 0x00])],
] as const;

for (const [caso, nombre, bytes] of rechazos) {
  const resultado = validateAttachment(nombre, new Uint8Array(bytes));
  anotar("SC-004", `rechaza ${caso}`, "rechazado", resultado.ok ? "aceptado" : "rechazado");
}

const grande = new Uint8Array(4 * 1024 * 1024 + 1);
grande.set(PNG.slice(0, 8));
anotar("SC-004", "rechaza más de 4 MB", "rechazado", validateAttachment("enorme.png", grande).ok ? "aceptado" : "rechazado");
anotar("SC-004", "acepta justo en el límite", "aceptado", validateAttachment("justo.png", (() => {
  const justo = new Uint8Array(4 * 1024 * 1024);
  justo.set(PNG.slice(0, 8));
  return justo;
})()).ok ? "aceptado" : "rechazado");

// ---------- SC-005: borrar la conversación deja el archivo inaccesible ----------

console.info("SC-005: borrado…");
const paraBorrar = await guardar("recibo.png", PNG, "imagen", "image/png", "bórrame");
const idAdjunto = paraBorrar.entrada?.attachment?.id;
const antes = await fetch(`${BASE}/api/adjuntos/${idAdjunto}`);
await deleteConversation(paraBorrar.conversationId);
const despues = await fetch(`${BASE}/api/adjuntos/${idAdjunto}`);

anotar("SC-005", "antes de borrar el archivo se sirve", "200", String(antes.status));
anotar("SC-005", "después de borrar ya no existe", "404", String(despues.status));

const [quedan] = await sql`select count(*)::int as n from conversation_attachments where id = ${idAdjunto}`;
anotar("SC-005", "el adjunto se borra en cascada", "0", String(quedan.n));

// ---------- Informe ----------

const limpiadas: string[] = [];
for (const id of creadas) if (await deleteConversation(id)) limpiadas.push(id);

const total = filas.length;
const cumplidas = filas.filter((f) => f.ok).length;
const porCriterio = [...new Set(filas.map((f) => f.criterio))].sort();

const informe = `# Validación 010 — Mensajes multimedia

- **Fecha:** ${new Date().toISOString().slice(0, 10)}
- **Resultado:** ${cumplidas} de ${total} comprobaciones
- **Saldo gastado:** ninguno. Un adjunto deriva por código antes de llamar al proveedor (FR-015), así que este guion no hace ninguna llamada al modelo.
- **Cómo se corrió:** \`npx tsx scripts/validacion-010.mts\` con el servidor de desarrollo levantado. Los archivos de muestra (PNG, WAV y PDF reales) se construyen dentro del guion.

${porCriterio
  .map((criterio) => {
    const suyas = filas.filter((f) => f.criterio === criterio);
    return `## ${criterio} — ${suyas.filter((f) => f.ok).length} de ${suyas.length}

| Caso | Esperado | Obtenido | |
|---|---|---|---|
${suyas.map((f) => `| ${f.caso} | ${f.esperado} | ${f.obtenido} | ${f.ok ? "✅" : "❌"} |`).join("\n")}`;
  })
  .join("\n\n")}

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
estaba condicionada a \`document.visibilityState === "visible"\`, así que abrirlo en segundo plano dejaba
la línea de tiempo vacía y el modo mal (decía «Responde la IA» aunque la conversación estuviera en modo
humano). Se reprodujo con \`visibilityState === "hidden"\`.

No lo introdujo la feature 010: viene de KAN-31 (#25), de la 004. El chat ya tenía este mismo arreglo
desde KAN-32, con su comentario; nunca se aplicó al detalle. Corregido aquí porque impedía validar el
lado del equipo.

## Limpieza

Se borraron ${limpiadas.length} de las ${creadas.length} conversaciones creadas. Las que no se borran son las que quedaron en modo humano esperando respuesta: la 004 no deja borrar una conversación pendiente.
`;

writeFileSync(new URL("./validacion-010.md", import.meta.url), informe);
console.info(`\n${cumplidas} de ${total} comprobaciones. Informe en scripts/validacion-010.md`);

await sql.end();
