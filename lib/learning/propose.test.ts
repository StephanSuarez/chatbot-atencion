// Integración contra la base de tests, con proveedor falso (plan 005 §9).
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { saveClientMessage, saveTeamReply, setMode } from "../conversations/service";
import { sql } from "../db";
import { ProviderError, type ChatMessage, type ChatResult, type Tool } from "../providers";

const fake = vi.hoisted(() => ({
  config: {} as { companyName: string; model: string | null; complete: boolean },
  credentials: null as unknown,
}));

const chat = vi.fn<(messages: ChatMessage[], model: string, key: string, tools?: Tool[]) => Promise<ChatResult>>();
vi.mock("../config-service", () => ({
  getConfig: async () => fake.config,
  getLlmCredentials: async () => fake.credentials,
}));

const { proposeFromConversation } = await import("./propose");
const { countPendingProposals, listPendingProposals, discardProposal } = await import("./service");

const propuesta = (titulo: string, contenido: string) =>
  chat.mockResolvedValue({ tool: "proponer_conocimiento", args: JSON.stringify({ titulo, contenido }) });

async function attended(text = "¿Tienen sillas altas para bebés?") {
  const { conversationId } = await saveClientMessage({ clientMessageId: randomUUID(), text });
  await setMode(conversationId, "humano");
  await saveTeamReply(conversationId, "Sí, tenemos dos sillas altas en la terraza.");
  return conversationId;
}

beforeEach(async () => {
  await sql`delete from knowledge_proposals; delete from conversations; delete from kb_chunks; delete from kb_entries`.simple();
  fake.config = { companyName: "Café Aurora", model: "modelo-x", complete: true };
  fake.credentials = { provider: { id: "fake", name: "Fake", chat }, apiKey: "sk-guardada" };
  chat.mockReset();
  propuesta("Sillas para bebés", "El local tiene dos sillas altas para bebés en la terraza.");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => sql.end());

describe("redactar la propuesta (FR-001, FR-002)", () => {
  it("propone a partir de la conversación y le ofrece la herramienta al modelo", async () => {
    const conversationId = await attended();
    await proposeFromConversation(conversationId);

    const [proposal] = await listPendingProposals();
    expect(proposal).toMatchObject({
      conversationId,
      title: "Sillas para bebés",
      content: "El local tiene dos sillas altas para bebés en la terraza.",
    });

    const [messages, model, key, tools] = chat.mock.calls[0];
    expect(model).toBe("modelo-x");
    expect(key).toBe("sk-guardada");
    expect(tools).toEqual([expect.objectContaining({ name: "proponer_conocimiento" })]);
    expect(messages[0].content).toContain("Café Aurora");
    expect(messages[0].content).toContain("No incluyas nombres, teléfonos");
    expect(messages[1].content).toContain("Cliente: ¿Tienen sillas altas para bebés?");
    expect(messages[1].content).toContain("Equipo: Sí, tenemos dos sillas altas");
  });

  it("no propone si la conversación no la atendió el equipo", async () => {
    const { conversationId } = await saveClientMessage({ clientMessageId: randomUUID(), text: "hola" });
    await proposeFromConversation(conversationId);

    expect(chat).not.toHaveBeenCalled();
    expect(await countPendingProposals()).toBe(0);
  });

  it("no propone dos veces por la misma conversación, ni siquiera tras descartar (FR-007)", async () => {
    const conversationId = await attended();
    await proposeFromConversation(conversationId);
    const [proposal] = await listPendingProposals();
    await discardProposal(proposal.id);

    await proposeFromConversation(conversationId);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(await countPendingProposals()).toBe(0);
  });

  it("sin configuración completa no llama al modelo", async () => {
    fake.config = { ...fake.config, complete: false };
    fake.credentials = null;
    await proposeFromConversation(await attended());
    expect(chat).not.toHaveBeenCalled();
  });
});

describe("cuando el modelo no colabora", () => {
  it.each([
    ["responde texto en vez de usar la herramienta", { text: "NADA" } as ChatResult],
    ["manda argumentos ilegibles", { tool: "proponer_conocimiento", args: "{ roto" } as ChatResult],
    ["manda el título vacío", { tool: "proponer_conocimiento", args: JSON.stringify({ titulo: " ", contenido: "x" }) } as ChatResult],
  ])("%s: no se guarda nada", async (_, result) => {
    chat.mockResolvedValue(result);
    await proposeFromConversation(await attended());
    expect(await countPendingProposals()).toBe(0);
  });

  it("si el proveedor falla, la propuesta queda pendiente con su motivo para reintentar (FR-009)", async () => {
    chat.mockRejectedValue(new ProviderError("fake", "timeout"));
    const conversationId = await attended();
    await proposeFromConversation(conversationId);

    const [proposal] = await listPendingProposals();
    expect(proposal).toMatchObject({ conversationId, title: null, content: null, error: expect.stringMatching(/no respondió/) });
  });

  it("un error que no es del proveedor no se esconde", async () => {
    chat.mockRejectedValue(new Error("bug"));
    await expect(proposeFromConversation(await attended())).rejects.toThrow("bug");
  });
});
