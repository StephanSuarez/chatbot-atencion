// Evaluación de la derivación (spec 004, SC-001…SC-004). Hace llamadas reales al proveedor con la key
// guardada: gasta saldo. Pide permiso al usuario antes de correrlo.
//
//   npx tsx scripts/evaluacion-004.mts
//
// Escribe el informe en scripts/evaluacion-004.md. Las conversaciones quedan guardadas y visibles en
// la pantalla «Conversaciones»: se pueden borrar desde ahí.

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

process.loadEnvFile(".env.local");

// Los módulos abren la base al importarse: se cargan después de leer el entorno.
const { sendMessage } = await import("../lib/chat/service.ts");
const { getConversation, getEntries } = await import("../lib/conversations/service.ts");
const { sql } = await import("../lib/db.ts");

// Entre llamadas: los modelos gratuitos limitan la frecuencia y responden "unavailable" si se les insiste.
const PAUSE_MS = 5000;
const RETRIES = 3;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pause = () => wait(PAUSE_MS);

// Un fallo del proveedor no es una decisión del bot: se reintenta antes de contarlo como caso.
async function ask(input: { conversationId?: string; message: string }) {
  let last = await sendMessage({ ...input, clientMessageId: randomUUID() });
  for (let attempt = 1; attempt <= RETRIES && !last.ok; attempt++) {
    await wait(PAUSE_MS * (attempt + 1));
    last = await sendMessage({ ...input, clientMessageId: randomUUID() });
  }
  return last;
}

interface Case {
  group: string;
  message: string;
  second?: string;
  expectHandoff: boolean;
}

// Lo que el bot NO sabe: nada de esto está en las entradas ni en los documentos, ni se deduce de ellos.
// («¿Hacen envíos a Medellín?» se descartó: se deduce del radio de 3 km de la entrada Domicilios.)
const NO_SABE = [
  "¿Tienen menú para niños?",
  "¿Dan clases de barismo?",
  "¿El local tiene aire acondicionado?",
  "¿Tienen sillas altas para bebés?",
  "¿Tienen sucursal en Chapinero?",
];

const ENOJO = [
  "Llevo 40 minutos esperando mi domicilio y nadie me responde, esto es una vergüenza.",
  "Me cobraron de más otra vez. Estoy harto de este lugar.",
  "El café llegó frío y derramado. Pésimo servicio, no vuelvo nunca más.",
  "Es la tercera vez que me equivocan el pedido. Qué desorden tan grande.",
  "Ustedes son unos irresponsables, me arruinaron el desayuno de la oficina.",
];

const PIDE_PERSONA = [
  ["Quiero hablar con una persona.", "No, en serio, páseme con alguien del equipo."],
  ["¿Me puede atender un humano?", "Insisto, quiero hablar con una persona."],
  ["Necesito hablar con alguien de verdad.", "Otra vez: quiero una persona, no un bot."],
  ["Páseme con un asesor por favor.", "Le repito, necesito hablar con un asesor."],
  ["Prefiero que me atienda una persona.", "Sí, una persona por favor."],
];

// Lo que el bot SÍ sabe: sale de las entradas y de los dos documentos cargados.
const SI_SABE = [
  "¿A qué hora abren los sábados?",
  "¿Dónde quedan?",
  "¿Tienen parqueadero?",
  "¿Cuánto cuesta el domicilio?",
  "¿Cuál es el pedido mínimo para domicilio?",
  "¿Puedo pagar con Nequi?",
  "¿Cuánto vale el capuchino?",
  "¿Cuánto cuesta el pan de bono?",
  "¿Hasta qué hora sirven desayunos?",
  "¿Puedo llevar a mi perro?",
];

const cases: Case[] = [
  ...NO_SABE.map((message) => ({ group: "no_sabe", message, expectHandoff: true })),
  ...ENOJO.map((message) => ({ group: "enojo", message, expectHandoff: true })),
  ...PIDE_PERSONA.map(([message, second]) => ({ group: "pide_persona", message, second, expectHandoff: true })),
  ...SI_SABE.map((message) => ({ group: "si_sabe", message, expectHandoff: false })),
];

interface Outcome {
  group: string;
  message: string;
  reply: string;
  handoff: boolean;
  handoffAfterFirst: boolean;
  note: string;
  ok: boolean;
  error?: string;
}

async function run(testCase: Case): Promise<Outcome> {
  const first = await ask({ message: testCase.message });
  if (!first.ok) {
    return { ...testCase, reply: "", handoff: false, handoffAfterFirst: false, note: "", ok: false, error: first.error };
  }

  const conversationId = first.conversationId;
  let reply = first.entries.map((entry) => entry.text).join(" ");
  const handoffAfterFirst = first.mode === "humano";

  if (testCase.second) {
    await pause();
    const second = await ask({ conversationId, message: testCase.second });
    if (!second.ok) {
      return { ...testCase, reply, handoff: handoffAfterFirst, handoffAfterFirst, note: "", ok: false, error: second.error };
    }
    reply = second.entries.map((entry) => entry.text).join(" ");
  }

  const conversation = await getConversation(conversationId);
  const entries = (await getEntries(conversationId, { forClient: false })) ?? [];
  const note = entries.filter((entry) => entry.author === "nota").map((entry) => entry.text).join(" / ");
  const handoff = conversation?.mode === "humano";

  // «Pide persona» solo acierta si derivó en el segundo mensaje, nunca en el primero (SC-003).
  const ok =
    testCase.group === "pide_persona" ? handoff && !handoffAfterFirst : handoff === testCase.expectHandoff;

  return { group: testCase.group, message: testCase.message, reply, handoff, handoffAfterFirst, note, ok };
}

const results: Outcome[] = [];
for (const [index, testCase] of cases.entries()) {
  process.stdout.write(`\r[${index + 1}/${cases.length}] ${testCase.group.padEnd(12)}`);
  results.push(await run(testCase));
  await pause();
}
process.stdout.write("\n");

const of = (group: string) => results.filter((result) => result.group === group);
const passed = (group: string) => of(group).filter((result) => result.ok).length;
const failures = results.filter((result) => result.error);

const criteria = [
  ["SC-001", "No sabe → deriva", `${passed("no_sabe")}/5`, passed("no_sabe") >= 4],
  ["SC-002", "Enojo → deriva", `${passed("enojo")}/5`, passed("enojo") >= 4],
  ["SC-003", "Pide persona → deriva al segundo, nunca al primero", `${passed("pide_persona")}/5`, passed("pide_persona") >= 4],
  ["SC-004", "Sí sabe → no deriva", `${passed("si_sabe")}/10`, passed("si_sabe") === 10],
] as const;

const row = (result: Outcome) =>
  `| ${result.group} | ${result.message.replace(/\|/g, "/")} | ${result.handoff ? "sí" : "no"} | ${
    result.ok ? "✅" : "❌"
  } | ${(result.error ?? result.note ?? "").replace(/\|/g, "/").slice(0, 160)} |`;

const report = `# Evaluación de la derivación — spec 004

Fecha: ${new Date().toISOString().slice(0, 16).replace("T", " ")}
Base de conocimiento: Café Aurora (6 entradas, 2 documentos).

## Criterios de éxito

| Criterio | Qué mide | Resultado | ¿Cumple? |
|---|---|---|---|
${criteria.map(([id, what, score, ok]) => `| ${id} | ${what} | ${score} | ${ok ? "✅" : "❌"} |`).join("\n")}

${failures.length ? `\n⚠️ ${failures.length} casos fallaron por error del proveedor y no cuentan como acierto.\n` : ""}
## Detalle

| Grupo | Mensaje | ¿Derivó? | ¿Esperado? | Nota del bot o error |
|---|---|---|---|---|
${results.map(row).join("\n")}

## Respuestas del bot

${results.map((result) => `- **${result.message}**\n  ${result.reply.replace(/\n/g, " ") || `(sin respuesta: ${result.error})`}`).join("\n")}
`;

writeFileSync(new URL("./evaluacion-004.md", import.meta.url), report);
console.log(report.slice(0, report.indexOf("## Detalle")));
console.log(`Informe completo en scripts/evaluacion-004.md`);
await sql.end();
