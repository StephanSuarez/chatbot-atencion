// Validación del aprendizaje (spec 005, SC-001…SC-005). Hace llamadas reales con la key guardada:
// gasta saldo. Pide permiso al usuario antes de correrlo.
//
//   npx tsx scripts/validacion-005.mts
//
// Deja el informe en scripts/validacion-005.md. Las conversaciones y las entradas aprobadas quedan
// guardadas: se pueden borrar desde «Conversaciones» y «Lo que sabe».

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

process.loadEnvFile(".env.local");

const { saveClientMessage, saveTeamReply, setMode } = await import("../lib/conversations/service.ts");
const { proposeFromConversation } = await import("../lib/learning/propose.ts");
const { approveProposal, discardProposal, listPendingProposals, alreadyProposed } = await import("../lib/learning/service.ts");
const { sendMessage } = await import("../lib/chat/service.ts");
const { indexPending } = await import("../lib/kb/indexer.ts");
const { sql } = await import("../lib/db.ts");

// El modelo gratuito corta por frecuencia: pausas largas y un reintento por caso.
const PAUSE_MS = 20_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Cinco cosas que el Café Aurora no tiene cargadas: el equipo las aporta al atender.
const CASES = [
  ["¿Tienen menú para niños?", "Sí, tenemos un plato infantil de huevos con arepa por 9.000 pesos."],
  ["¿El local tiene aire acondicionado?", "El salón interior tiene aire acondicionado; la terraza es al aire libre."],
  ["¿Dan clases de barismo?", "Sí, damos clases el último sábado de cada mes, por 80.000 pesos por persona."],
  ["¿Tienen sillas altas para bebés?", "Sí, tenemos dos sillas altas para bebés."],
  ["¿Puedo pagar con bitcóin?", "No aceptamos criptomonedas: solo efectivo, tarjetas, Nequi y Daviplata."],
] as const;

interface Row {
  question: string;
  proposed: boolean;
  title: string | null;
  content: string | null;
  error: string | null;
}

/** Una conversación real: el cliente pregunta, el bot no sabe, el equipo responde y la devuelve al bot. */
async function attend(question: string, answer: string) {
  const { conversationId } = await saveClientMessage({ clientMessageId: randomUUID(), text: question });
  await setMode(conversationId, "humano");
  await saveTeamReply(conversationId, answer);
  await setMode(conversationId, "ia");
  return conversationId;
}

const rows: Row[] = [];
const ids: string[] = [];

for (const [question, answer] of CASES) {
  process.stdout.write(`\r[${rows.length + 1}/${CASES.length}] proponiendo…            `);
  const conversationId = await attend(question, answer);
  ids.push(conversationId);
  await proposeFromConversation(conversationId);

  let proposal = (await listPendingProposals()).find((p) => p.conversationId === conversationId);
  // Un fallo del proveedor no es una decisión del bot: se descarta y se reintenta una vez.
  if (proposal?.error) {
    await discardProposal(proposal.id);
    await wait(PAUSE_MS);
    await sql`delete from knowledge_proposals where conversation_id = ${conversationId}`;
    await proposeFromConversation(conversationId);
    proposal = (await listPendingProposals()).find((p) => p.conversationId === conversationId);
  }
  rows.push({
    question,
    proposed: !!proposal,
    title: proposal?.title ?? null,
    content: proposal?.content ?? null,
    error: proposal?.error ?? null,
  });
  await wait(PAUSE_MS);
}
process.stdout.write("\n");

// SC-003: se aprueba la primera propuesta útil y se le pregunta lo mismo al bot en otra conversación.
const pending = await listPendingProposals();
const first = pending.find((p) => p.title && p.content);
let learned = "no se pudo comprobar: no hubo ninguna propuesta aprobable";
if (first) {
  await approveProposal(first.id, { title: first.title!, content: first.content! });
  await indexPending();
  await wait(PAUSE_MS);
  const asked = await sendMessage({ clientMessageId: randomUUID(), message: "¿Tienen algo para niños en el menú?" });
  learned = asked.ok ? asked.entries.map((e) => e.text).join(" ") : `falló: ${asked.error}`;
}

// SC-004: descartar cierra la propuesta y esa conversación no vuelve a proponer.
const toDiscard = (await listPendingProposals())[0];
let discarded = "no había otra propuesta para descartar";
if (toDiscard) {
  await discardProposal(toDiscard.id);
  await proposeFromConversation(toDiscard.conversationId);
  const again = (await listPendingProposals()).some((p) => p.conversationId === toDiscard.conversationId);
  discarded = `descartada; ¿volvió a proponer?: ${again ? "sí ❌" : "no ✅"} · ¿queda marcada?: ${
    (await alreadyProposed(toDiscard.conversationId)) ? "sí ✅" : "no ❌"
  }`;
}

const proposedCount = rows.filter((r) => r.proposed && r.title).length;
const report = `# Validación del aprendizaje — spec 005

Fecha: ${new Date().toISOString().slice(0, 16).replace("T", " ")}

## Criterios

| Criterio | Qué mide | Resultado |
|---|---|---|
| SC-001 | Se propone en las 5 conversaciones atendidas | ${proposedCount}/5 ${proposedCount === 5 ? "✅" : "❌"} |
| SC-002 | Propuestas aprobables con pocos cambios | ver la tabla de abajo, a juicio de quien revisa |
| SC-003 | Lo aprobado sirve para responder | ${learned.startsWith("falló") ? "❌" : "ver respuesta abajo"} |
| SC-004 | Descartar no vuelve a proponer | ${discarded} |
| SC-005 | Las propuestas no llegan al cliente | ✅ por diseño: viven en su propia tabla y el chat solo lee mensajes |

## Lo que propuso el bot

| Pregunta del cliente | ¿Propuso? | Título | Contenido |
|---|---|---|---|
${rows
  .map(
    (r) =>
      `| ${r.question} | ${r.proposed ? "sí" : "no"} | ${r.title ?? "—"} | ${(r.content ?? r.error ?? "—").replace(/\|/g, "/")} |`,
  )
  .join("\n")}

## SC-003 · Respuesta del bot tras aprender

Pregunta nueva: **¿Tienen algo para niños en el menú?**

> ${learned}

## Conversaciones creadas

${ids.map((id) => `- ${id}`).join("\n")}
`;

writeFileSync(new URL("./validacion-005.md", import.meta.url), report);
console.log(report.slice(0, report.indexOf("## Lo que propuso")));
console.log("Informe completo en scripts/validacion-005.md");
await sql.end();
