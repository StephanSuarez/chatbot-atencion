// Integración contra la base de tests, con credenciales y proveedor falsos: no se gasta saldo.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, sql } from "../db";
import { EMBEDDING_MODEL, ProviderError } from "../providers";
import { EMBEDDING_DIMENSIONS, kbChunks, kbEntries } from "../schema";

const fake = vi.hoisted(() => ({
  credentials: null as { provider: unknown; apiKey: string } | null,
}));
vi.mock("../config-service", () => ({ getLlmCredentials: async () => fake.credentials }));

const { BATCH_SIZE, indexPending } = await import("./indexer");

const vectorFor = (text: string) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? text.length : 0));
const embed = vi.fn(async (texts: string[]) => texts.map(vectorFor));

async function addChunks(count: number, extra: Partial<typeof kbChunks.$inferInsert> = {}) {
  const [entry] = await db.insert(kbEntries).values({ title: "t", content: "c" }).returning();
  await db
    .insert(kbChunks)
    .values(Array.from({ length: count }, (_, i) => ({ entryId: entry.id, position: i, text: `pedazo ${i}`, ...extra })));
}

const pending = async () =>
  (await sql`select count(*)::int as n from kb_chunks where embedding is null or embedding_model <> ${EMBEDDING_MODEL}`)[0].n;

beforeEach(async () => {
  await sql`delete from kb_chunks; delete from kb_documents; delete from kb_entries`.simple();
  embed.mockClear().mockImplementation(async (texts: string[]) => texts.map(vectorFor));
  fake.credentials = { provider: { embed }, apiKey: "sk-guardada" };
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(() => sql.end());

describe("indexador", () => {
  it("sin credenciales (configuración incompleta) no hace nada y los pedazos quedan pendientes", async () => {
    fake.credentials = null;
    await addChunks(3);
    expect(await indexPending()).toBe(0);
    expect(await pending()).toBe(3);
  });

  it("calcula y guarda el vector de los pendientes con la key guardada", async () => {
    await addChunks(3);
    expect(await indexPending()).toBe(3);

    expect(embed).toHaveBeenCalledWith(expect.arrayContaining(["pedazo 0", "pedazo 1", "pedazo 2"]), "sk-guardada");
    const rows = await db.select().from(kbChunks);
    for (const row of rows) {
      expect(row.embeddingModel).toBe(EMBEDDING_MODEL);
      expect(row.embedding?.[0]).toBe(row.text.length);
    }
  });

  it(`procesa en lotes de ${BATCH_SIZE}`, async () => {
    await addChunks(BATCH_SIZE + 50);
    expect(await indexPending()).toBe(BATCH_SIZE + 50);
    expect(embed.mock.calls.map(([texts]) => texts.length)).toEqual([BATCH_SIZE, 50]);
  });

  it("es idempotente: una segunda ejecución no llama al proveedor", async () => {
    await addChunks(3);
    await indexPending();
    embed.mockClear();
    expect(await indexPending()).toBe(0);
    expect(embed).not.toHaveBeenCalled();
  });

  it("recalcula los pedazos indexados con otro modelo", async () => {
    await addChunks(2, { embedding: vectorFor("x"), embeddingModel: "modelo-viejo" });
    expect(await indexPending()).toBe(2);
    expect(await pending()).toBe(0);
  });

  it("si el proveedor falla, quedan pendientes y la próxima ejecución los completa", async () => {
    await addChunks(3);
    embed.mockRejectedValueOnce(new ProviderError("fake", "unavailable"));
    expect(await indexPending()).toBe(0);
    expect(await pending()).toBe(3);

    expect(await indexPending()).toBe(3);
    expect(await pending()).toBe(0);
  });

  it("un error que no es del proveedor no se esconde", async () => {
    await addChunks(1);
    embed.mockRejectedValueOnce(new Error("bug"));
    await expect(indexPending()).rejects.toThrow("bug");
  });
});
