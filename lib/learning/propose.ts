import { getConfig, getLlmCredentials } from "../config-service";
import { getEntries } from "../conversations/service";
import { ProviderError, type ChatMessage, type Tool } from "../providers";
import { alreadyProposed, hasTeamMessages, saveProposal } from "./service";

// Redacta lo que el bot podría aprender de una conversación atendida por el equipo (plan 005 §6).
// Nunca guarda conocimiento: solo una propuesta que una persona tiene que aprobar.

const MAX_TEXT = 1000;
const HISTORY_LIMIT = 30;

export const PROPONER: Tool = {
  name: "proponer_conocimiento",
  description: "Propone una entrada para la base de conocimiento de la empresa a partir de esta conversación.",
  parameters: {
    type: "object",
    properties: {
      titulo: { type: "string", description: "Tema de la información, en pocas palabras. Por ejemplo: «Sillas para bebés»." },
      contenido: { type: "string", description: "La información de la empresa, redactada para responder a futuros clientes." },
    },
    required: ["titulo", "contenido"],
    additionalProperties: false,
  },
};

const RULES = [
  "Escribe información de la empresa, no un resumen de la conversación.",
  "Usa tercera persona y frases completas, como si fuera una ficha informativa.",
  "No incluyas nombres, teléfonos, direcciones ni ningún dato del cliente.",
  "No inventes nada que no esté dicho en la conversación.",
  "Si en la conversación no hay información reutilizable, no uses la herramienta y responde: NADA.",
];

const AUTHOR: Record<string, string> = { cliente: "Cliente", bot: "Bot", equipo: "Equipo" };

/** Prepara la propuesta de una conversación. Pensado para correr en segundo plano (`after`). */
export async function proposeFromConversation(conversationId: string): Promise<void> {
  if (await alreadyProposed(conversationId)) return;
  if (!(await hasTeamMessages(conversationId))) return;

  const [config, credentials] = await Promise.all([getConfig(), getLlmCredentials()]);
  if (!config.complete || !credentials || !config.model) return;

  const entries = (await getEntries(conversationId, { forClient: true })) ?? [];
  const transcript = entries
    .slice(-HISTORY_LIMIT)
    .map((entry) => `${AUTHOR[entry.author] ?? entry.author}: ${entry.text.slice(0, MAX_TEXT)}`)
    .join("\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        `Ayudas al equipo de ${config.companyName} a guardar lo que aprendió atendiendo a un cliente.`,
        "Reglas:",
        ...RULES.map((rule, i) => `${i + 1}. ${rule}`),
      ].join("\n"),
    },
    { role: "user", content: `Conversación:\n${transcript}` },
  ];

  const started = Date.now();
  try {
    const result = await credentials.provider.chat(messages, config.model, credentials.apiKey, [PROPONER]);
    const proposal = "tool" in result ? parseProposal(result.args) : null;
    if (!proposal) {
      console.info(`[aprendizaje] conv=${conversationId}: el modelo no propuso nada, ${Date.now() - started} ms`);
      return;
    }
    await saveProposal(conversationId, proposal);
    console.info(`[aprendizaje] conv=${conversationId}: propuesta guardada, ${Date.now() - started} ms`);
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    // Se guarda pendiente con el motivo: el equipo puede reintentarlo (FR-009).
    await saveProposal(conversationId, { error: "No pudimos redactar la propuesta: el proveedor no respondió." });
    console.error(`[aprendizaje] conv=${conversationId}: ${e.kind}`);
  }
}

// Los argumentos son salida del modelo, no confiable (principio 3).
function parseProposal(args: string): { title: string; content: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args.trim() || "{}");
  } catch {
    return null;
  }
  const { titulo, contenido } = (parsed ?? {}) as Record<string, unknown>;
  const title = typeof titulo === "string" ? titulo.trim() : "";
  const content = typeof contenido === "string" ? contenido.trim() : "";
  return title && content ? { title, content } : null;
}
