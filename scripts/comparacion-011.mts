// Comparación antes/después de la 011 (spec SC-003): las mismas preguntas contra el motor viejo (main)
// y contra el grafo, con el modelo real configurado en local. Se compara la decisión (responde,
// deriva y por qué, agenda), no la redacción, porque el modelo no es determinista.
//
//   npx tsx scripts/comparacion-011.mts antes     (en main, antes de conectar el grafo)
//   npx tsx scripts/comparacion-011.mts despues   (en la rama, con el grafo conectado)
//
// Deja scripts/comparacion-011.<etiqueta>.json. Las conversaciones quedan con origen «simulacion».
// Gasta saldo si el modelo configurado no es gratuito.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const { sendMessage } = await import("../lib/chat/service");
const { sql } = await import("../lib/db");

// El modelo gratuito corta por frecuencia: pausa larga entre preguntas y reintentos con espera.
const PAUSE_MS = 10_000;
const RETRY_MS = 25_000;
const ATTEMPTS = 4;
const QUESTIONS = [
  "¿A qué hora abren los sábados?",
  "¿Hacen domicilios? ¿Cuál es el pedido mínimo?",
  "¿Aceptan pago con Nequi?",
  "¿Tienen leche de almendras para el café?",
  "Esto es un desastre, llevo una hora esperando mi pedido y nadie me responde. ¡Pésimo servicio!",
  "Quiero hablar con una persona, por favor.",
];

const label = process.argv[2];
if (!label) throw new Error("Falta la etiqueta: antes | despues");

const results = [];
for (const [i, question] of QUESTIONS.entries()) {
  const started = Date.now();
  let sent = await sendMessage({ clientMessageId: randomUUID(), message: question, origin: "simulacion" });
  for (let attempt = 1; !sent.ok && attempt < ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, RETRY_MS));
    sent = await sendMessage({ clientMessageId: randomUUID(), message: question, origin: "simulacion" });
  }
  const conversation = sent.conversationId ? await sql`select handoff_reason from conversations where id = ${sent.conversationId}` : [];
  const reason = conversation[0]?.handoff_reason ?? null;
  const decision = !sent.ok ? `error: ${sent.error}` : sent.mode === "humano" ? `deriva (${reason})` : "responde";
  const answer = sent.ok ? sent.entries.map((e) => e.text).join(" ") : null;
  results.push({ question, decision, answer, ms: Date.now() - started, conversationId: sent.conversationId ?? null });
  console.log(`${i + 1}. ${decision} · ${Date.now() - started} ms · ${question}`);
  if (i < QUESTIONS.length - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
}

writeFileSync(`scripts/comparacion-011.${label}.json`, JSON.stringify({ label, when: new Date().toISOString(), results }, null, 2));
await sql.end();
console.log(`Guardado en scripts/comparacion-011.${label}.json`);
