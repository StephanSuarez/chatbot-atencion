import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, validateAttachment } from "./validate";

// Las cabeceras se construyen a mano en vez de guardar archivos binarios en el repo: la validación
// solo mira los primeros bytes. Cada firma se comprobó antes contra un archivo real (los de macOS y
// los generados con ffmpeg), no de memoria.

const bytes = (...parts: (number | string)[]) =>
  new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : [part])));

const relleno = (n = 32) => new Array(n).fill(0x41);

const HEADERS: Record<string, Uint8Array> = {
  "foto.jpg": bytes(0xff, 0xd8, 0xff, 0xe1, ...relleno()),
  "foto.png": bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, ...relleno()),
  "foto.gif": bytes("GIF89a", ...relleno()),
  "foto.webp": bytes("RIFF", 0x36, 0, 0, 0, "WEBP", ...relleno()),
  "nota.mp3": bytes("ID3", 0x04, ...relleno()),
  "nota.m4a": bytes(0, 0, 0, 0x1c, "ftyp", "M4A ", ...relleno()),
  "nota.ogg": bytes("OggS", ...relleno()),
  "nota.wav": bytes("RIFF", 0x6a, 0x66, 0x04, 0, "WAVE", ...relleno()),
  "factura.pdf": bytes("%PDF-1.7", ...relleno()),
  "carta.docx": bytes("PK", 0x03, 0x04, ...relleno()),
  // Con acento a propósito: se codifica de verdad en UTF-8, porque `bytes` solo sirve para ASCII.
  "precios.txt": new TextEncoder().encode("Café con leche: 5000"),
};

// El tipo de contenido se comprueba uno por uno, y no solo la categoría: es el que el servidor
// impondrá al servir el archivo (plan §7), así que un cambio ahí tiene consecuencias de seguridad.
const EXPECTED: Record<string, { category: string; contentType: string }> = {
  jpg: { category: "imagen", contentType: "image/jpeg" },
  png: { category: "imagen", contentType: "image/png" },
  gif: { category: "imagen", contentType: "image/gif" },
  webp: { category: "imagen", contentType: "image/webp" },
  mp3: { category: "audio", contentType: "audio/mpeg" },
  m4a: { category: "audio", contentType: "audio/mp4" },
  ogg: { category: "audio", contentType: "audio/ogg" },
  wav: { category: "audio", contentType: "audio/wav" },
  pdf: { category: "documento", contentType: "application/pdf" },
  docx: {
    category: "documento",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  txt: { category: "documento", contentType: "text/plain; charset=utf-8" },
};

describe("archivos aceptados", () => {
  for (const [name, data] of Object.entries(HEADERS)) {
    const extension = name.split(".").pop()!;
    it(`acepta ${name} como ${EXPECTED[extension].category}, sirviéndose ${EXPECTED[extension].contentType}`, () => {
      expect(validateAttachment(name, data)).toEqual({ ok: true, ...EXPECTED[extension] });
    });
  }

  it("la extensión no distingue mayúsculas", () => {
    expect(validateAttachment("FOTO.PNG", HEADERS["foto.png"])).toEqual({ ok: true, ...EXPECTED.png });
  });

  it("ningún tipo servido es ejecutable en el navegador", () => {
    const servidos = Object.values(EXPECTED).map((e) => e.contentType);
    expect(servidos.some((tipo) => /html|javascript|svg/.test(tipo))).toBe(false);
  });

  it("un mp3 sin etiqueta ID3 empieza por el sincronismo de trama", () => {
    expect(validateAttachment("nota.mp3", bytes(0xff, 0xfb, 0x14, 0x64, ...relleno()))).toMatchObject({ ok: true });
  });
});

describe("el contenido tiene que corresponder a la extensión (principio 3)", () => {
  it("un PNG renombrado a .pdf se rechaza", () => {
    const result = validateAttachment("disfrazado.pdf", HEADERS["foto.png"]);
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/no es un PDF válido/) });
  });

  it("un ejecutable renombrado a .png se rechaza", () => {
    expect(validateAttachment("malo.png", bytes(0x4d, 0x5a, ...relleno()))).toMatchObject({ ok: false });
  });

  it("un .txt con bytes nulos se rechaza por binario", () => {
    expect(validateAttachment("malo.txt", bytes(0x48, 0x00, 0x49))).toMatchObject({ ok: false });
  });

  it("un .txt que no es UTF-8 se rechaza", () => {
    expect(validateAttachment("malo.txt", new Uint8Array([0xff, 0xfe, 0x41]))).toMatchObject({ ok: false });
  });

  it("un RIFF que no es WEBP no pasa como imagen", () => {
    expect(validateAttachment("falso.webp", bytes("RIFF", 0, 0, 0, 0, "WAVE", ...relleno()))).toMatchObject({
      ok: false,
    });
  });
});

describe("tipos no permitidos", () => {
  it("el SVG se rechaza, aunque sea una imagen", () => {
    const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(validateAttachment("icono.svg", svg)).toEqual({ ok: false, error: expect.stringMatching(/Se aceptan/) });
  });

  it("el video se rechaza (fuera de alcance de la 010)", () => {
    expect(validateAttachment("clip.mp4", bytes(0, 0, 0, 0x1c, "ftyp", ...relleno()))).toMatchObject({ ok: false });
  });

  it("un archivo sin extensión se rechaza", () => {
    expect(validateAttachment("archivo", HEADERS["foto.png"])).toMatchObject({ ok: false });
  });
});

describe("tamaño", () => {
  it("rechaza lo que pasa de 4 MB", () => {
    const grande = new Uint8Array(MAX_FILE_BYTES + 1);
    grande.set(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a));
    expect(validateAttachment("enorme.png", grande)).toEqual({
      ok: false,
      error: expect.stringMatching(/más de 4 MB/),
    });
  });

  it("acepta justo en el límite", () => {
    const limite = new Uint8Array(MAX_FILE_BYTES);
    limite.set(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a));
    expect(validateAttachment("justo.png", limite)).toMatchObject({ ok: true });
  });

  it("rechaza un archivo vacío", () => {
    expect(validateAttachment("vacio.png", new Uint8Array())).toEqual({
      ok: false,
      error: expect.stringMatching(/vacío/),
    });
  });
});
