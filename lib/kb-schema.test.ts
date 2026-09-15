// Integración contra la base de tests (ver vitest.setup.ts): lo que garantiza la base, no el código.
import { asc, cosineDistance, isNotNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, sql } from "./db";
import { EMBEDDING_DIMENSIONS, kbChunks, kbDocuments, kbEntries } from "./schema";

// Vector unitario en el eje i: dos ejes distintos están a distancia coseno 1; el mismo eje, a 0.
const axis = (i: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, k) => (k === i ? 1 : 0));

async function newDocument(contentHash = "hash-1") {
  const [doc] = await db.insert(kbDocuments).values({ name: "menu.pdf", contentHash, status: "listo" }).returning();
  return doc;
}

beforeEach(() => sql`delete from kb_chunks; delete from kb_documents; delete from kb_entries`.simple());
afterAll(() => sql.end());

describe("base de conocimiento en PostgreSQL", () => {
  it("busca pedazos por similitud coseno", async () => {
    const doc = await newDocument();
    await db.insert(kbChunks).values([
      { documentId: doc.id, position: 0, text: "horarios", embedding: axis(0), embeddingModel: "m" },
      { documentId: doc.id, position: 1, text: "precios", embedding: axis(1), embeddingModel: "m" },
      { documentId: doc.id, position: 2, text: "pendiente" },
    ]);

    const question = axis(1).map((v, k) => (k === 0 ? 0.3 : v));
    const distance = cosineDistance(kbChunks.embedding, question);
    const rows = await db.select({ text: kbChunks.text }).from(kbChunks).where(isNotNull(kbChunks.embedding)).orderBy(asc(distance));

    expect(rows.map((r) => r.text)).toEqual(["precios", "horarios"]);
  });

  it("borrar un documento o una entrada borra sus pedazos (FR-010)", async () => {
    const doc = await newDocument();
    const [entry] = await db.insert(kbEntries).values({ title: "Horarios", content: "9 a 5" }).returning();
    await db.insert(kbChunks).values([
      { documentId: doc.id, position: 0, text: "a" },
      { entryId: entry.id, position: 0, text: "b" },
    ]);

    await sql`delete from kb_documents`;
    await sql`delete from kb_entries`;
    const [{ count }] = await sql`select count(*)::int as count from kb_chunks`;
    expect(count).toBe(0);
  });

  it("rechaza un documento con la misma huella (FR-009)", async () => {
    await newDocument("igual");
    await expect(newDocument("igual")).rejects.toThrow();
  });

  it("un pedazo pertenece a exactamente un origen", async () => {
    const doc = await newDocument();
    const [entry] = await db.insert(kbEntries).values({ title: "t", content: "c" }).returning();
    await expect(db.insert(kbChunks).values({ position: 0, text: "sin origen" })).rejects.toThrow();
    await expect(
      db.insert(kbChunks).values({ documentId: doc.id, entryId: entry.id, position: 0, text: "dos orígenes" }),
    ).rejects.toThrow();
  });

  it("rechaza un estado de documento desconocido", async () => {
    await expect(sql`insert into kb_documents (name, content_hash, status) values ('x', 'h', 'otro')`).rejects.toThrow(
      /kb_documents_status/,
    );
  });
});
