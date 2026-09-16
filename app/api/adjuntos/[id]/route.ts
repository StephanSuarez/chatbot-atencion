import { getAttachment } from "../../../../lib/conversations/service";

// Devuelve el archivo de un mensaje (plan 010 §7). Es la primera superficie del proyecto que sirve
// contenido subido por un tercero, y encima desde el mismo origen que la plataforma: aquí las cabeceras
// importan tanto como el contenido.

// Los documentos se descargan en vez de abrirse: un documento servido en línea desde el propio origen es
// la vía clásica de XSS almacenado. Las imágenes y los audios sí se muestran, que es el sentido de la feature.
const INLINE: string[] = ["imagen", "audio"];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = await getAttachment(id);
  // Un id que no existe y uno borrado responden igual: el id es lo único que protege el archivo (principio 11).
  if (!file) return new Response("No encontrado", { status: 404 });

  const disposition = INLINE.includes(file.category) ? "inline" : "attachment";
  return new Response(file.data, {
    headers: {
      // El tipo lo decide el servidor desde la lista permitida; nunca el que declaró quien subió el archivo.
      "Content-Type": file.contentType,
      "Content-Length": String(file.data.length),
      // `filename*` va codificado: así un nombre con comillas o saltos de línea no parte la cabecera.
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      // El contenido de un id nunca cambia. `private` lo mantiene fuera de caches compartidas.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
