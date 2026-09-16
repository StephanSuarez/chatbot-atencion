// Integración contra la base de tests (plan 005 §9).
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteConversation, saveClientMessage, saveTeamReply, setMode } from "../conversations/service";
import { db, sql } from "../db";
import { listEntries } from "../kb/service";
import { kbEntries } from "../schema";
import {
  alreadyProposed,
  approveProposal,
  countPendingProposals,
  discardProposal,
  hasTeamMessages,
  listPendingProposals,
  saveProposal,
} from "./service";

beforeEach(async () => {
  await sql`delete from knowledge_proposals; delete from conversations; delete from kb_chunks; delete from kb_entries`.simple();
});
afterAll(() => sql.end());

// Una conversación atendida por el equipo: cliente pregunta, el equipo responde.
async function attended(text = "¿Tienen sillas altas para bebés?") {
  const { conversationId } = await saveClientMessage({ clientMessageId: randomUUID(), text });
  await setMode(conversationId, "humano");
  await saveTeamReply(conversationId, "Sí, tenemos dos sillas altas.");
  return conversationId;
}

describe("qué se puede aprender (FR-001)", () => {
  it("una conversación con respuesta del equipo sí tiene algo que aprender", async () => {
    expect(await hasTeamMessages(await attended())).toBe(true);
  });

  it("una conversación que atendió solo el bot no tiene nada que aprender", async () => {
    const { conversationId } = await saveClientMessage({ clientMessageId: randomUUID(), text: "hola" });
    expect(await hasTeamMessages(conversationId)).toBe(false);
  });
});

describe("guardar propuestas (FR-003, FR-009)", () => {
  it("guarda la propuesta y la cuenta como pendiente", async () => {
    const conversationId = await attended();
    expect(await saveProposal(conversationId, { title: "Sillas altas", content: "Hay dos sillas altas." })).toBe(true);

    const [proposal] = await listPendingProposals();
    expect(proposal).toMatchObject({ conversationId, title: "Sillas altas", content: "Hay dos sillas altas.", error: null });
    expect(await countPendingProposals()).toBe(1);
  });

  it("una conversación no puede tener dos propuestas pendientes", async () => {
    const conversationId = await attended();
    expect(await saveProposal(conversationId, { title: "a", content: "b" })).toBe(true);
    expect(await saveProposal(conversationId, { title: "c", content: "d" })).toBe(false);
    expect(await countPendingProposals()).toBe(1);
  });

  it("si la redacción falla, la propuesta queda pendiente con su motivo", async () => {
    const conversationId = await attended();
    await saveProposal(conversationId, { error: "No pudimos contactar al proveedor." });

    const [proposal] = await listPendingProposals();
    expect(proposal).toMatchObject({ title: null, content: null, error: "No pudimos contactar al proveedor." });
  });

  it("recorta títulos y contenidos larguísimos que venga a decir el modelo", async () => {
    const conversationId = await attended();
    await saveProposal(conversationId, { title: "t".repeat(500), content: "c".repeat(9000) });

    const [proposal] = await listPendingProposals();
    expect(proposal.title).toHaveLength(200);
    expect(proposal.content).toHaveLength(4000);
  });
});

describe("aprobar y descartar (FR-005…FR-008)", () => {
  it("aprobar crea la entrada con lo editado y la marca como aprendida", async () => {
    const conversationId = await attended();
    await saveProposal(conversationId, { title: "Propuesto", content: "Texto propuesto" });
    const [proposal] = await listPendingProposals();

    const result = await approveProposal(proposal.id, { title: "Sillas para bebés", content: "El local tiene dos sillas altas." });
    expect(result.ok).toBe(true);

    const [entry] = await listEntries();
    expect(entry).toMatchObject({ title: "Sillas para bebés", content: "El local tiene dos sillas altas." });
    const [row] = await db.select({ from: kbEntries.learnedFromConversationId }).from(kbEntries);
    expect(row.from).toBe(conversationId);
    expect(await countPendingProposals()).toBe(0);
  });

  it("no se puede aprobar dos veces", async () => {
    const conversationId = await attended();
    await saveProposal(conversationId, { title: "t", content: "c" });
    const [proposal] = await listPendingProposals();

    expect((await approveProposal(proposal.id, { title: "t", content: "c" })).ok).toBe(true);
    expect(await approveProposal(proposal.id, { title: "t", content: "c" })).toEqual({ ok: false, error: expect.any(String) });
    expect(await listEntries()).toHaveLength(1);
  });

  it("aprobar con el título vacío no guarda nada y lo dice", async () => {
    const conversationId = await attended();
    await saveProposal(conversationId, { title: "t", content: "c" });
    const [proposal] = await listPendingProposals();

    expect(await approveProposal(proposal.id, { title: "  ", content: "c" })).toEqual({ ok: false, error: expect.any(String) });
    expect(await listEntries()).toEqual([]);
    expect(await countPendingProposals()).toBe(1);
  });

  it("descartar la saca de pendientes y esa conversación ya no propone más", async () => {
    const conversationId = await attended();
    await saveProposal(conversationId, { title: "t", content: "c" });
    const [proposal] = await listPendingProposals();

    expect(await discardProposal(proposal.id)).toBe(true);
    expect(await countPendingProposals()).toBe(0);
    expect(await alreadyProposed(conversationId)).toBe(true);
    expect(await discardProposal(proposal.id)).toBe(false);
  });

  it("la entrada aprendida sobrevive al borrado de su conversación (FR-008)", async () => {
    const conversationId = await attended();
    await saveProposal(conversationId, { title: "t", content: "c" });
    const [proposal] = await listPendingProposals();
    await approveProposal(proposal.id, { title: "Sillas", content: "Dos sillas altas." });

    await setMode(conversationId, "ia");
    expect(await deleteConversation(conversationId)).toBe(true);

    const [entry] = await listEntries();
    expect(entry).toMatchObject({ title: "Sillas" });
    const [row] = await db.select({ from: kbEntries.learnedFromConversationId }).from(kbEntries);
    expect(row.from).toBeNull();
  });
});
