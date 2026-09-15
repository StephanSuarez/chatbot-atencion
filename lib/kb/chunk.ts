// Del texto a pedazos para indexar (plan 002 §4). Regla mecánica, no entiende el contenido:
// junta párrafos hasta ~CHUNK_SIZE y repite el final del pedazo anterior para no partir una idea en el corte.

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 150;

export function chunkText(header: string, text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces(text)) {
    if (current && current.length + 2 + piece.length > CHUNK_SIZE) {
      chunks.push(current);
      current = overlapTail(current);
    }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current) chunks.push(current);
  // El encabezado conserva de dónde viene cada pedazo cuando se lo recupera suelto (003).
  return chunks.map((chunk) => `[${header}]\n${chunk}`);
}

function pieces(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (p.length <= CHUNK_SIZE ? [p] : p.split(/(?<=[.!?])\s+/)))
    .flatMap((s) => (s.length <= CHUNK_SIZE ? [s] : hardCut(s)));
}

const hardCut = (s: string) =>
  Array.from({ length: Math.ceil(s.length / CHUNK_SIZE) }, (_, i) => s.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));

function overlapTail(chunk: string): string {
  const tail = chunk.slice(-CHUNK_OVERLAP);
  const firstSpace = tail.search(/\s/);
  return firstSpace >= 0 ? tail.slice(firstSpace + 1) : tail;
}
