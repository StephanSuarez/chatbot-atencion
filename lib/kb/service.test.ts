// Integración contra la base de tests con el extractor y el partidor reales; el indexador no participa.
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, sql } from "../db";
import { kbChunks, kbDocuments } from "../schema";
import {
  countPendingChunks,
  deleteDocument,
  deleteEntry,
  getDocumentText,
  listDocuments,
  listEntries,
  MAX_DOCUMENTS,
  MAX_FILE_BYTES,
  saveEntry,
  uploadDocument,
} from "./service";

const txt = (s: string) => new TextEncoder().encode(s);
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const chunksOf = (column: "entry_id" | "document_id", id: string) =>
  sql`select text from kb_chunks where ${sql(column)} = ${id} order by position`;

beforeEach(async () => {
  await sql`delete from kb_chunks; delete from kb_documents; delete from kb_entries`.simple();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => sql.end());

describe("entradas de texto (HU-1)", () => {
  it("crea la entrada y sus pedazos, con el título como encabezado", async () => {
    const result = await saveEntry({ title: " Horarios ", content: " Lunes a viernes de 9 a 19. " });
    expect(result.ok).toBe(true);
    const [entry] = await listEntries();
    expect(entry).toMatchObject({ title: "Horarios", content: "Lunes a viernes de 9 a 19." });
    expect(await chunksOf("entry_id", entry.id)).toEqual([{ text: "[Horarios]\nLunes a viernes de 9 a 19." }]);
  });

  it.each([
    [{ title: "", content: "x" }, "title"],
    [{ title: "x", content: "   " }, "content"],
  ])("rechaza título o contenido vacío sin guardar nada (%o)", async (input, field) => {
    const result = await saveEntry(input);
    expect(result).toEqual({ ok: false, errors: { [field]: expect.any(String) } });
    expect(await listEntries()).toEqual([]);
  });

  it("editar reemplaza el contenido y los pedazos (quedan pendientes de indexar otra vez)", async () => {
    const created = await saveEntry({ title: "Horarios", content: "9 a 19" });
    if (!created.ok) throw new Error("no se creó");
    await db.update(kbChunks).set({ embeddingModel: "text-embedding-3-small" });

    await saveEntry({ id: created.id, title: "Horarios", content: "10 a 20" });
    expect(await chunksOf("entry_id", created.id)).toEqual([{ text: "[Horarios]\n10 a 20" }]);
    expect(await countPendingChunks()).toBe(1);
  });

  it("editar una entrada que ya no existe avisa y no crea nada", async () => {
    const result = await saveEntry({ id: "00000000-0000-0000-0000-000000000000", title: "t", content: "c" });
    expect(result).toEqual({ ok: false, errors: { form: expect.any(String) } });
    expect(await listEntries()).toEqual([]);
  });

  it("eliminar borra la entrada y sus pedazos", async () => {
    const created = await saveEntry({ title: "t", content: "c" });
    if (!created.ok) throw new Error("no se creó");
    await deleteEntry(created.id);
    expect(await listEntries()).toEqual([]);
    expect(await countPendingChunks()).toBe(0);
  });
});

describe("documentos (HU-2, HU-3)", () => {
  it("un .txt queda listo, con su texto visible y sus pedazos", async () => {
    const result = await uploadDocument("precios.txt", fixture("precios.txt"));
    if (!result.ok) throw new Error(result.error);

    expect(await listDocuments()).toEqual([expect.objectContaining({ name: "precios.txt", status: "listo", error: null })]);
    expect(await getDocumentText(result.id)).toContain("Café con leche: 5.000 pesos.");
    const [chunk] = await chunksOf("document_id", result.id);
    expect(chunk.text.startsWith("[precios.txt]\n")).toBe(true);
  });

  it("un PDF sin texto queda en 'no se pudo leer' con el motivo y sin pedazos (SC-003)", async () => {
    const result = await uploadDocument("escaneado.pdf", fixture("escaneado.pdf"));
    if (!result.ok) throw new Error(result.error);

    const [doc] = await listDocuments();
    expect(doc).toMatchObject({ status: "no_se_pudo_leer", error: expect.stringMatching(/No encontramos texto/) });
    expect(await getDocumentText(result.id)).toBeNull();
    expect(await countPendingChunks()).toBe(0);
  });

  it("rechaza tipos no permitidos y archivos de más de 4 MB sin guardar nada (SC-004)", async () => {
    expect(await uploadDocument("hoja.xlsx", txt("x"))).toEqual({ ok: false, error: expect.stringMatching(/Solo se aceptan/) });
    expect(await uploadDocument("grande.txt", new Uint8Array(MAX_FILE_BYTES + 1).fill(97))).toEqual({
      ok: false,
      error: expect.stringMatching(/4 MB/),
    });
    expect(await listDocuments()).toEqual([]);
  });

  it(`rechaza el documento ${MAX_DOCUMENTS + 1} (FR-004)`, async () => {
    await db
      .insert(kbDocuments)
      .values(Array.from({ length: MAX_DOCUMENTS }, (_, i) => ({ name: `d${i}.txt`, contentHash: `h${i}`, status: "listo" as const })));
    expect(await uploadDocument("otro.txt", txt("hola"))).toEqual({ ok: false, error: expect.stringMatching(/Ya tienes 20/) });
  });

  it("dos subidas a la vez con 19 documentos: solo una pasa", async () => {
    await db
      .insert(kbDocuments)
      .values(Array.from({ length: MAX_DOCUMENTS - 1 }, (_, i) => ({ name: `d${i}.txt`, contentHash: `h${i}`, status: "listo" as const })));
    const results = await Promise.all([uploadDocument("a.txt", txt("uno")), uploadDocument("b.txt", txt("dos"))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await listDocuments()).toHaveLength(MAX_DOCUMENTS);
  });

  it("rechaza el mismo contenido aunque tenga otro nombre (FR-009)", async () => {
    await uploadDocument("precios.txt", fixture("precios.txt"));
    expect(await uploadDocument("copia.txt", fixture("precios.txt"))).toEqual({
      ok: false,
      error: 'Este archivo ya está cargado como "precios.txt".',
    });
  });

  it("un 'procesando' de más de 5 minutos se muestra como 'no se pudo leer'", async () => {
    const createdAt = new Date("2026-09-14T10:00:00Z");
    await db.insert(kbDocuments).values({ name: "a.pdf", contentHash: "h", status: "procesando", createdAt });

    expect((await listDocuments(new Date("2026-09-14T10:04:00Z")))[0].status).toBe("procesando");
    expect((await listDocuments(new Date("2026-09-14T10:06:00Z")))[0]).toMatchObject({
      status: "no_se_pudo_leer",
      error: expect.stringMatching(/Vuelve a subir/),
    });
  });

  it("eliminar borra el documento y sus pedazos (SC-005)", async () => {
    const result = await uploadDocument("precios.txt", fixture("precios.txt"));
    if (!result.ok) throw new Error(result.error);
    await deleteDocument(result.id);
    expect(await listDocuments()).toEqual([]);
    expect(await countPendingChunks()).toBe(0);
  });
});
