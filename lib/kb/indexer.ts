import { eq, isNull, ne, or } from "drizzle-orm";
import { getLlmCredentials } from "../config-service";
import { db } from "../db";
import { EMBEDDING_MODEL, ProviderError } from "../providers";
import { kbChunks } from "../schema";

export const BATCH_SIZE = 100;

// Calcula el vector de los pedazos pendientes: sin vector o calculados con otro modelo (plan 002 §3).
// Se puede lanzar cuantas veces se quiera. Sin credenciales, o si el proveedor falla, quedan pendientes para la próxima.
// ponytail: dos ejecuciones a la vez pueden calcular el mismo lote dos veces (mismo resultado, doble costo);
// un advisory lock de PostgreSQL si ese costo llega a importar.
export async function indexPending(): Promise<number> {
  const credentials = await getLlmCredentials();
  if (!credentials) return 0;

  let indexed = 0;
  for (;;) {
    const batch = await db
      .select({ id: kbChunks.id, text: kbChunks.text })
      .from(kbChunks)
      .where(or(isNull(kbChunks.embedding), ne(kbChunks.embeddingModel, EMBEDDING_MODEL)))
      .orderBy(kbChunks.id)
      .limit(BATCH_SIZE);
    if (!batch.length) break;

    let vectors: number[][];
    try {
      vectors = await credentials.provider.embed(
        batch.map((chunk) => chunk.text),
        credentials.apiKey,
      );
    } catch (e) {
      if (e instanceof ProviderError) break;
      throw e;
    }

    await db.transaction(async (tx) => {
      for (const [i, chunk] of batch.entries()) {
        await tx.update(kbChunks).set({ embedding: vectors[i], embeddingModel: EMBEDDING_MODEL }).where(eq(kbChunks.id, chunk.id));
      }
    });
    indexed += batch.length;
  }

  if (indexed) console.info(`[kb] ${indexed} pedazos indexados`);
  return indexed;
}
