// La acción es el límite por el que entra el archivo del equipo (plan 010 §4, principio 3).
// El servicio de conversaciones va falso: lo suyo ya está probado aparte.
import { describe, expect, it, vi } from "vitest";

const saveTeamReply = vi.hoisted(() => vi.fn(async () => true));
vi.mock("../../lib/conversations/service", () => ({
  saveTeamReply,
  deleteConversation: vi.fn(),
  getConversation: vi.fn(),
  getEntries: vi.fn(),
  setMode: vi.fn(),
}));
vi.mock("../../lib/learning/propose", () => ({ proposeFromConversation: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { replyAction } = await import("./actions");

const ID = "11111111-2222-3333-4444-555555555555";
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];

const form = (campos: { text?: string; file?: File }) => {
  const data = new FormData();
  data.set("id", ID);
  data.set("text", campos.text ?? "");
  if (campos.file) data.set("file", campos.file);
  return data;
};

const pdf = (name = "nota-credito.pdf") => new File([new Uint8Array(PDF)], name, { type: "application/pdf" });

describe("responder con un archivo", () => {
  it("un archivo válido llega al servicio con su categoría y su tipo", async () => {
    saveTeamReply.mockClear();
    expect(await replyAction(form({ text: "Aquí la tienes", file: pdf() }))).toEqual({ ok: true });

    expect(saveTeamReply).toHaveBeenCalledWith(
      ID,
      "Aquí la tienes",
      expect.objectContaining({ name: "nota-credito.pdf", category: "documento", contentType: "application/pdf" }),
    );
  });

  it("una respuesta solo con archivo, sin texto, es válida", async () => {
    saveTeamReply.mockClear();
    expect(await replyAction(form({ file: pdf() }))).toEqual({ ok: true });
    expect(saveTeamReply).toHaveBeenCalledWith(ID, "", expect.objectContaining({ category: "documento" }));
  });

  it("sin texto y sin archivo no hay nada que enviar", async () => {
    saveTeamReply.mockClear();
    expect(await replyAction(form({}))).toEqual({ ok: false, error: "Escribe una respuesta." });
    expect(saveTeamReply).not.toHaveBeenCalled();
  });

  it("un tipo no permitido se rechaza sin tocar la conversación", async () => {
    saveTeamReply.mockClear();
    const svg = new File([new Uint8Array([0x3c, 0x73, 0x76, 0x67])], "icono.svg", { type: "image/svg+xml" });

    expect(await replyAction(form({ file: svg }))).toEqual({ ok: false, error: expect.stringMatching(/Se aceptan/) });
    expect(saveTeamReply).not.toHaveBeenCalled();
  });

  it("un archivo cuyo contenido no corresponde a su extensión se rechaza", async () => {
    saveTeamReply.mockClear();
    const falso = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], "factura.pdf", { type: "application/pdf" });

    expect(await replyAction(form({ file: falso }))).toMatchObject({ ok: false });
    expect(saveTeamReply).not.toHaveBeenCalled();
  });

  it("en modo IA no se puede responder, ni con archivo", async () => {
    saveTeamReply.mockClear().mockResolvedValueOnce(false);
    expect(await replyAction(form({ text: "hola", file: pdf() }))).toEqual({
      ok: false,
      error: expect.stringMatching(/Respondes tú/),
    });
  });
});
