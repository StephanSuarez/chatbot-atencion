// Decide si un archivo adjunto es aceptable (plan 010 §4 y §7). No guarda nada y no extrae texto:
// solo mira el nombre y los primeros bytes. Lo que llega de fuera no es confiable (principio 3),
// así que la extensión solo elige el formato y la firma real del contenido tiene que coincidir.

export type Category = "imagen" | "audio" | "documento";

// El mismo límite que la base de conocimiento (002) y por la misma causa externa: el despliegue no
// acepta peticiones de más de 4,5 MB. Se define aquí en vez de importarlo de `lib/kb`, que arrastraría
// ese módulo y su base de datos al camino de los mensajes.
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export type ValidationResult =
  | { ok: true; category: Category; contentType: string }
  | { ok: false; error: string };

interface Format {
  category: Category;
  /** El tipo que impone el servidor al servir el archivo. Nunca se usa el que declara quien sube. */
  contentType: string;
  label: string;
  matches: (data: Uint8Array) => boolean;
}

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

const startsWith = (data: Uint8Array, bytes: number[], at = 0) =>
  bytes.every((byte, i) => data[at + i] === byte);

/** RIFF lleva el tamaño en los bytes 4 a 7 y el formato concreto en el 8. */
const riff = (data: Uint8Array, tag: string) =>
  startsWith(data, ascii("RIFF")) && startsWith(data, ascii(tag), 8);

/**
 * Un MP3 puede empezar con la etiqueta ID3 o directamente con el sincronismo de trama: 0xFF y los
 * tres bits altos del siguiente byte a 1 (comprobado con archivos reales de ffmpeg, con y sin etiqueta).
 */
const isMp3 = (data: Uint8Array) =>
  startsWith(data, ascii("ID3")) || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0);

/** Texto plano: UTF-8 válido y sin bytes nulos, que delatan un binario renombrado. */
const isText = (data: Uint8Array) => {
  if (data.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
};

const jpeg: Format = {
  category: "imagen",
  contentType: "image/jpeg",
  label: "JPG",
  matches: (data) => startsWith(data, [0xff, 0xd8, 0xff]),
};

// Sin SVG a propósito (plan §7): es el único formato de imagen que puede llevar script dentro, y estos
// archivos se sirven desde el mismo origen que la plataforma.
const FORMATS: Record<string, Format> = {
  jpg: jpeg,
  jpeg,
  png: {
    category: "imagen",
    contentType: "image/png",
    label: "PNG",
    matches: (data) => startsWith(data, [0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  gif: {
    category: "imagen",
    contentType: "image/gif",
    label: "GIF",
    matches: (data) => startsWith(data, ascii("GIF87a")) || startsWith(data, ascii("GIF89a")),
  },
  webp: {
    category: "imagen",
    contentType: "image/webp",
    label: "WebP",
    matches: (data) => riff(data, "WEBP"),
  },
  mp3: { category: "audio", contentType: "audio/mpeg", label: "MP3", matches: isMp3 },
  m4a: {
    category: "audio",
    contentType: "audio/mp4",
    label: "M4A",
    // En los formatos de la familia MP4 la firma no está al principio: `ftyp` empieza en el byte 4.
    matches: (data) => startsWith(data, ascii("ftyp"), 4),
  },
  ogg: {
    category: "audio",
    contentType: "audio/ogg",
    label: "OGG",
    matches: (data) => startsWith(data, ascii("OggS")),
  },
  wav: {
    category: "audio",
    contentType: "audio/wav",
    label: "WAV",
    matches: (data) => riff(data, "WAVE"),
  },
  pdf: {
    category: "documento",
    contentType: "application/pdf",
    label: "PDF",
    matches: (data) => startsWith(data, ascii("%PDF-")),
  },
  docx: {
    category: "documento",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word (.docx)",
    // Un .docx es un zip.
    matches: (data) => startsWith(data, ascii("PK")),
  },
  txt: {
    category: "documento",
    contentType: "text/plain; charset=utf-8",
    label: "texto (.txt)",
    matches: isText,
  },
};

/** Para el selector de archivos de la pantalla: `.jpg,.png,…` */
export const ACCEPTED_EXTENSIONS = Object.keys(FORMATS).map((extension) => `.${extension}`);

const ACCEPTED =
  "Se aceptan imágenes (JPG, PNG, WebP, GIF), audios (MP3, M4A, OGG, WAV) y documentos (PDF, Word y .txt).";

export function validateAttachment(fileName: string, data: Uint8Array): ValidationResult {
  if (!data.length) return { ok: false, error: "El archivo está vacío." };
  if (data.length > MAX_FILE_BYTES) return { ok: false, error: "El archivo pesa más de 4 MB." };

  const format = FORMATS[fileName.split(".").pop()?.toLowerCase() ?? ""];
  if (!format) return { ok: false, error: ACCEPTED };
  if (!format.matches(data)) return { ok: false, error: `El archivo no es un ${format.label} válido.` };

  return { ok: true, category: format.category, contentType: format.contentType };
}
