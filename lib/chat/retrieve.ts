import { and, cosineDistance, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { EMBEDDING_MODEL, type ChatMessage, type Provider } from "../providers";
import { kbChunks, kbDocuments, kbEntries } from "../schema";

export const TOP_K = 5;
// ponytail: valor inicial sin calibrar; se ajusta con la evaluación de 25 preguntas del Café Aurora (KAN-23).
export const MIN_SIMILARITY = 0.3;

export interface FoundChunk {
  text: string;
  source: string;
  similarity: number;
}

// La pregunta sola no alcanza para seguir el tema («¿y los sábados?»): se busca con el mensaje anterior del usuario.
export function retrievalQuery(history: ChatMessage[], message: string): string {
  const previous = history.findLast((m) => m.role === "user")?.content;
  return previous ? `${previous}\n${message}` : message;
}

// Los pedazos más parecidos a la consulta, solo entre los indexados con el modelo actual (002).
export async function findRelated(query: string, provider: Provider, apiKey: string): Promise<FoundChunk[]> {
  const [vector] = await provider.embed([query], apiKey);
  const similarity = sql<number>`1 - (${cosineDistance(kbChunks.embedding, vector)})`;
  const rows = await db
    .select({
      text: kbChunks.text,
      source: sql<string>`coalesce(${kbEntries.title}, ${kbDocuments.name})`,
      similarity,
    })
    .from(kbChunks)
    .leftJoin(kbEntries, eq(kbEntries.id, kbChunks.entryId))
    .leftJoin(kbDocuments, eq(kbDocuments.id, kbChunks.documentId))
    .where(and(isNotNull(kbChunks.embedding), eq(kbChunks.embeddingModel, EMBEDDING_MODEL), gt(similarity, MIN_SIMILARITY)))
    .orderBy(desc(similarity))
    .limit(TOP_K);
  return rows.map((row) => ({ ...row, similarity: Number(row.similarity) }));
}
