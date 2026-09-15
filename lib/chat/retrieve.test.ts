// Integración contra la base de tests con un proveedor falso: los vectores son ejes, así el parecido es exacto.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, sql } from "../db";
import { EMBEDDING_MODEL, type Provider } from "../providers";
import { EMBEDDING_DIMENSIONS, kbChunks, kbDocuments, kbEntries } from "../schema";
import { findRelated, MIN_SIMILARITY, retrievalQuery, TOP_K } from "./retrieve";

const axis = (i: number): number[] => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, k) => (k === i ? 1 : 0));
// Cerca del eje 0 y algo del eje 1: parecido ≈ 0,91 con el eje 0, ≈ 0,41 con el eje 1 y 0 con el resto.
const question: number[] = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, k) => (k === 0 ? 0.9 : k === 1 ? 0.4 : 0));

const embed = vi.fn(async (): Promise<number[][]> => [question]);
const provider = { embed } as unknown as Provider;

async function seed() {
  const [entry] = await db.insert(kbEntries).values({ title: "Horarios", content: "c" }).returning();
  const [doc] = await db.insert(kbDocuments).values({ name: "menu.txt", contentHash: "h", status: "listo" }).returning();
  await db.insert(kbChunks).values([
    { entryId: entry.id, position: 0, text: "[Horarios]\nAbrimos a las 7:00", embedding: axis(0), embeddingModel: EMBEDDING_MODEL },
    { documentId: doc.id, position: 0, text: "[menu.txt]\nCapuchino", embedding: axis(1), embeddingModel: EMBEDDING_MODEL },
    { documentId: doc.id, position: 1, text: "[menu.txt]\nNada que ver", embedding: axis(2), embeddingModel: EMBEDDING_MODEL },
    { documentId: doc.id, position: 2, text: "pendiente" },
    { documentId: doc.id, position: 3, text: "otro modelo", embedding: axis(0), embeddingModel: "modelo-viejo" },
  ]);
}

beforeEach(async () => {
  await sql`delete from kb_chunks; delete from kb_documents; delete from kb_entries`.simple();
  embed.mockClear();
});
afterAll(() => sql.end());

describe("buscador", () => {
  it("devuelve los más parecidos primero, con su origen y parecido, sobre el mínimo", async () => {
    await seed();
    const found = await findRelated("¿a qué hora abren?", provider, "sk-x");

    expect(embed).toHaveBeenCalledWith(["¿a qué hora abren?"], "sk-x");
    expect(found.map((f) => f.source)).toEqual(["Horarios", "menu.txt"]);
    expect(found[0].text).toBe("[Horarios]\nAbrimos a las 7:00");
    expect(found[0].similarity).toBeCloseTo(0.9 / Math.sqrt(0.97), 3);
    expect(found.every((f) => f.similarity > MIN_SIMILARITY)).toBe(true);
  });

  it("ignora los pedazos pendientes y los indexados con otro modelo", async () => {
    await seed();
    const texts = (await findRelated("q", provider, "sk-x")).map((f) => f.text);
    expect(texts).not.toContain("pendiente");
    expect(texts).not.toContain("otro modelo");
  });

  it(`trae como máximo ${TOP_K} pedazos`, async () => {
    const [entry] = await db.insert(kbEntries).values({ title: "t", content: "c" }).returning();
    await db
      .insert(kbChunks)
      .values(Array.from({ length: TOP_K + 3 }, (_, i) => ({ entryId: entry.id, position: i, text: `p${i}`, embedding: axis(0), embeddingModel: EMBEDDING_MODEL })));
    expect(await findRelated("q", provider, "sk-x")).toHaveLength(TOP_K);
  });

  it("sin nada parecido devuelve una lista vacía", async () => {
    embed.mockResolvedValueOnce([axis(5)]);
    await seed();
    expect(await findRelated("q", provider, "sk-x")).toEqual([]);
  });
});

describe("consulta de búsqueda", () => {
  it("usa la pregunta sola si no hay mensajes anteriores del usuario", () => {
    expect(retrievalQuery([], "¿A qué hora abren?")).toBe("¿A qué hora abren?");
  });

  it("agrega el último mensaje del usuario para seguir el tema", () => {
    const history = [
      { role: "user" as const, content: "¿A qué hora abren entre semana?" },
      { role: "assistant" as const, content: "A las 7:00." },
    ];
    expect(retrievalQuery(history, "¿y los sábados?")).toBe("¿A qué hora abren entre semana?\n¿y los sábados?");
  });
});
