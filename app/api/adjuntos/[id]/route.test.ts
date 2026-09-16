// Integración contra la base de tests: la ruta se llama como una función normal (plan 010 §9).
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "../../../../lib/db";
import { getEntries, saveClientMessage, type NewAttachment } from "../../../../lib/conversations/service";
import { GET } from "./route";

beforeEach(async () => {
  await sql`delete from conversations`;
});
afterAll(() => sql.end());

const PNG: NewAttachment = {
  name: "recibo.png",
  category: "imagen",
  contentType: "image/png",
  data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x07, 0x42]),
};

/** Guarda un adjunto y devuelve la respuesta de pedirlo por su URL. */
async function serve(attachment: NewAttachment = PNG) {
  const { conversationId } = await saveClientMessage({
    clientMessageId: randomUUID(),
    text: "mira esto",
    attachment,
  });
  const [entry] = (await getEntries(conversationId, { forClient: true }))!;
  const id = entry.attachment!.id;
  return GET(new Request(`http://localhost/api/adjuntos/${id}`), { params: Promise.resolve({ id }) });
}

describe("servir adjuntos (FR-007, FR-008)", () => {
  it("devuelve los bytes con el tipo que guardó el servidor", async () => {
    const response = await serve();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(PNG.data.length));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG.data);
  });

  it("las imágenes y los audios se muestran en la conversación", async () => {
    expect((await serve()).headers.get("content-disposition")).toMatch(/^inline;/);

    const audio: NewAttachment = { ...PNG, name: "nota.ogg", category: "audio", contentType: "audio/ogg" };
    expect((await serve(audio)).headers.get("content-disposition")).toMatch(/^inline;/);
  });

  it("los documentos se descargan, no se abren en la página", async () => {
    const pdf: NewAttachment = {
      name: "factura.pdf",
      category: "documento",
      contentType: "application/pdf",
      data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    };
    const response = await serve(pdf);

    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("content-type")).toBe("application/pdf");
  });

  it("siempre responde nosniff, para que el navegador no reinterprete el contenido", async () => {
    expect((await serve()).headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("no queda en caches compartidas", async () => {
    expect((await serve()).headers.get("cache-control")).toMatch(/private/);
  });
});

describe("nombres y errores", () => {
  it("un nombre con comillas o saltos de línea no parte la cabecera", async () => {
    const raro: NewAttachment = { ...PNG, name: 'fac"tura\r\nX-Colado: si.png' };
    const disposition = (await serve(raro)).headers.get("content-disposition")!;

    expect(disposition).not.toMatch(/[\r\n"]/);
    expect(disposition).toContain("filename*=UTF-8''");
  });

  it("un adjunto que no existe responde 404", async () => {
    const id = randomUUID();
    const response = await GET(new Request(`http://localhost/api/adjuntos/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(404);
  });

  it("un id que no es un uuid responde 404 igual, sin delatar nada", async () => {
    const response = await GET(new Request("http://localhost/api/adjuntos/../../secreto"), {
      params: Promise.resolve({ id: "../../secreto" }),
    });
    expect(response.status).toBe(404);
  });

  it("borrar la conversación deja el archivo inaccesible (SC-005)", async () => {
    const { conversationId } = await saveClientMessage({
      clientMessageId: randomUUID(),
      text: "mira esto",
      attachment: PNG,
    });
    const [entry] = (await getEntries(conversationId, { forClient: true }))!;
    const id = entry.attachment!.id;

    await sql`delete from conversations where id = ${conversationId}`;

    const response = await GET(new Request(`http://localhost/api/adjuntos/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(404);
  });
});
