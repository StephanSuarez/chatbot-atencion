import { describe, expect, it } from "vitest";
import { CHUNK_OVERLAP, CHUNK_SIZE, chunkText } from "./chunk";

const body = (chunk: string) => chunk.slice(chunk.indexOf("\n") + 1);
const paragraph = (n: number) => `Párrafo ${n}. ` + "palabra ".repeat(40).trim() + ".";

describe("partidor", () => {
  it("texto corto: un solo pedazo con encabezado", () => {
    expect(chunkText("menu.pdf", "Abrimos a las 9.")).toEqual(["[menu.pdf]\nAbrimos a las 9."]);
  });

  it("texto vacío: ningún pedazo", () => {
    expect(chunkText("x", "  \n\n ")).toEqual([]);
  });

  it("texto largo: varios pedazos que no pasan del tamaño más el solapamiento", () => {
    const text = Array.from({ length: 30 }, (_, i) => paragraph(i)).join("\n\n");
    const chunks = chunkText("menu.pdf", text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith("[menu.pdf]\n")).toBe(true);
      expect(body(chunk).length).toBeLessThanOrEqual(CHUNK_SIZE + CHUNK_OVERLAP + 2);
    }
  });

  it("no parte un párrafo que cabe entero", () => {
    const text = Array.from({ length: 30 }, (_, i) => paragraph(i)).join("\n\n");
    const all = chunkText("x", text).map(body).join("\n\n");
    for (let i = 0; i < 30; i++) expect(all).toContain(paragraph(i));
  });

  it("cada pedazo empieza repitiendo el final del anterior", () => {
    const text = Array.from({ length: 30 }, (_, i) => paragraph(i)).join("\n\n");
    const chunks = chunkText("x", text).map(body);
    for (let i = 1; i < chunks.length; i++) {
      const firstPiece = chunks[i].split("\n\n")[0];
      expect(chunks[i - 1].endsWith(firstPiece)).toBe(true);
      expect(firstPiece.length).toBeGreaterThan(0);
      expect(firstPiece.length).toBeLessThanOrEqual(CHUNK_OVERLAP);
    }
  });

  it("un párrafo enorme se parte por oraciones y una palabra sin espacios, en cortes fijos", () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `Oración número ${i} con algo de texto.`).join(" ");
    const giantWord = "x".repeat(CHUNK_SIZE * 2 + 10);
    const chunks = chunkText("x", `${sentences}\n\n${giantWord}`).map(body);

    expect(chunks.join(" ")).toContain("Oración número 39 con algo de texto.");
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE + CHUNK_OVERLAP + 2);
  });
});
