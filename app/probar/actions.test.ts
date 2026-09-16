// La acción es el límite por el que entra el archivo: aquí se comprueba que lo malo no pasa de aquí
// (plan 010 §4, principio 3). El servicio de chat va falso: lo suyo ya está probado aparte.
import { describe, expect, it, vi } from "vitest";

const sendMessage = vi.hoisted(() => vi.fn(async () => ({ ok: true }) as never));
vi.mock("../../lib/chat/service", () => ({ sendMessage }));

const { sendMessageAction } = await import("./actions");

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x10, 0x20];

const formWith = (file?: File, message = "mira esto") => {
  const form = new FormData();
  form.set("clientMessageId", crypto.randomUUID());
  form.set("message", message);
  if (file) form.set("file", file);
  return form;
};

const png = (name = "recibo.png") => new File([new Uint8Array(PNG)], name, { type: "image/png" });

describe("el archivo se valida antes de llegar al servicio", () => {
  it("un archivo válido llega al chat con su categoría y su tipo", async () => {
    sendMessage.mockClear();
    expect(await sendMessageAction(formWith(png()))).toMatchObject({ ok: true });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: expect.objectContaining({
          name: "recibo.png",
          category: "imagen",
          contentType: "image/png",
        }),
      }),
    );
  });

  it("un tipo no permitido se rechaza sin llamar al chat", async () => {
    sendMessage.mockClear();
    const svg = new File([new Uint8Array([0x3c, 0x73, 0x76, 0x67])], "icono.svg", { type: "image/svg+xml" });

    expect(await sendMessageAction(formWith(svg))).toEqual({ ok: false, error: expect.stringMatching(/Se aceptan/) });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("un archivo cuyo contenido no corresponde a su extensión se rechaza", async () => {
    sendMessage.mockClear();
    const falso = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], "foto.png", { type: "image/png" });

    expect(await sendMessageAction(formWith(falso))).toMatchObject({ ok: false });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sin archivo, el mensaje sigue su camino normal", async () => {
    sendMessage.mockClear();
    await sendMessageAction(formWith(undefined, "¿a qué hora abren?"));

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ message: "¿a qué hora abren?", attachment: undefined }));
  });

  it("un nombre larguísimo no se guarda entero", async () => {
    sendMessage.mockClear();
    // Al recortarlo se pierde la extensión, así que se rechaza: es el lado seguro.
    expect(await sendMessageAction(formWith(png(`${"a".repeat(300)}.png`)))).toMatchObject({ ok: false });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
