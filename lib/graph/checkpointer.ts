import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  copyCheckpoint,
  getCheckpointId,
  WRITES_IDX_MAP,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import { and, asc, desc, eq, lt, type SQL } from "drizzle-orm";
import { db } from "../db";
import { graphCheckpointWrites, graphCheckpoints } from "../schema";

// Checkpoints de LangGraph en Postgres, por la misma conexión que el resto de la app (plan 011 §5, §12).
// Los bytes vienen del serializador del propio LangGraph y se guardan tal cual, con su tipo.

const bytes = (value: Uint8Array) => new Uint8Array(value);

const MISSING_THREAD = "Falta thread_id en configurable: sin él no se sabe a qué hilo pertenece el checkpoint.";

type Row = typeof graphCheckpoints.$inferSelect;

export class DbSaver extends BaseCheckpointSaver {
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    if (typeof threadId !== "string") return undefined;
    const checkpointNs = config.configurable?.checkpoint_ns ?? "";
    const checkpointId = getCheckpointId(config);
    const conditions = [eq(graphCheckpoints.threadId, threadId), eq(graphCheckpoints.checkpointNs, checkpointNs)];
    if (checkpointId) conditions.push(eq(graphCheckpoints.checkpointId, checkpointId));
    const [row] = await db
      .select()
      .from(graphCheckpoints)
      .where(and(...conditions))
      .orderBy(desc(graphCheckpoints.checkpointId))
      .limit(1);
    return row && this.tuple(row);
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const { before, limit, filter } = options ?? {};
    const conditions: SQL[] = [];
    const { thread_id, checkpoint_ns, checkpoint_id } = config.configurable ?? {};
    if (typeof thread_id === "string") conditions.push(eq(graphCheckpoints.threadId, thread_id));
    if (typeof checkpoint_ns === "string") conditions.push(eq(graphCheckpoints.checkpointNs, checkpoint_ns));
    if (typeof checkpoint_id === "string") conditions.push(eq(graphCheckpoints.checkpointId, checkpoint_id));
    const beforeId = before?.configurable?.checkpoint_id;
    if (typeof beforeId === "string") conditions.push(lt(graphCheckpoints.checkpointId, beforeId));

    const rows = await db
      .select()
      .from(graphCheckpoints)
      .where(and(...conditions))
      .orderBy(graphCheckpoints.threadId, graphCheckpoints.checkpointNs, desc(graphCheckpoints.checkpointId));

    // El filtro compara metadatos ya deserializados, así que el límite se aplica aquí y no en SQL.
    let remaining = limit ?? Infinity;
    for (const row of rows) {
      if (remaining <= 0) return;
      const tuple = await this.tuple(row);
      if (filter && !Object.entries(filter).every(([key, value]) => tuple.metadata?.[key as keyof CheckpointMetadata] === value)) continue;
      remaining -= 1;
      yield tuple;
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id;
    if (typeof threadId !== "string") throw new Error(MISSING_THREAD);
    const checkpointNs = config.configurable?.checkpoint_ns ?? "";
    const parent = config.configurable?.checkpoint_id;
    const [[type, data], [metadataType, metadataData]] = await Promise.all([
      this.serde.dumpsTyped(copyCheckpoint(checkpoint)),
      this.serde.dumpsTyped(metadata),
    ]);
    const values = {
      parentCheckpointId: typeof parent === "string" ? parent : null,
      type,
      checkpoint: bytes(data),
      metadataType,
      metadata: bytes(metadataData),
    };
    await db
      .insert(graphCheckpoints)
      .values({ threadId, checkpointNs, checkpointId: checkpoint.id, ...values })
      .onConflictDoUpdate({
        target: [graphCheckpoints.threadId, graphCheckpoints.checkpointNs, graphCheckpoints.checkpointId],
        set: values,
      });
    return { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id;
    if (typeof threadId !== "string") throw new Error(MISSING_THREAD);
    const checkpointId = config.configurable?.checkpoint_id;
    if (typeof checkpointId !== "string") throw new Error("Falta checkpoint_id en configurable: las escrituras pendientes cuelgan de un checkpoint.");
    const checkpointNs = config.configurable?.checkpoint_ns ?? "";

    const rows = await Promise.all(
      writes.map(async ([channel, value], i) => {
        const [type, data] = await this.serde.dumpsTyped(value);
        return { threadId, checkpointNs, checkpointId, taskId, idx: WRITES_IDX_MAP[channel] ?? i, channel, type, value: bytes(data) };
      }),
    );
    // Misma regla que MemorySaver: una escritura normal no se pisa; las especiales (índice negativo:
    // error, interrupción, reanudación) reflejan siempre el último estado.
    const regular = rows.filter((row) => row.idx >= 0);
    const special = rows.filter((row) => row.idx < 0);
    await db.transaction(async (tx) => {
      if (regular.length) await tx.insert(graphCheckpointWrites).values(regular).onConflictDoNothing();
      for (const row of special) {
        await tx
          .insert(graphCheckpointWrites)
          .values(row)
          .onConflictDoUpdate({
            target: [
              graphCheckpointWrites.threadId,
              graphCheckpointWrites.checkpointNs,
              graphCheckpointWrites.checkpointId,
              graphCheckpointWrites.taskId,
              graphCheckpointWrites.idx,
            ],
            set: { channel: row.channel, type: row.type, value: row.value },
          });
      }
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(graphCheckpointWrites).where(eq(graphCheckpointWrites.threadId, threadId));
      await tx.delete(graphCheckpoints).where(eq(graphCheckpoints.threadId, threadId));
    });
  }

  private async tuple(row: Row): Promise<CheckpointTuple> {
    const key = { thread_id: row.threadId, checkpoint_ns: row.checkpointNs };
    const [checkpoint, metadata, writes] = await Promise.all([
      this.serde.loadsTyped(row.type, row.checkpoint) as Promise<Checkpoint>,
      this.serde.loadsTyped(row.metadataType, row.metadata) as Promise<CheckpointMetadata>,
      db
        .select()
        .from(graphCheckpointWrites)
        .where(
          and(
            eq(graphCheckpointWrites.threadId, row.threadId),
            eq(graphCheckpointWrites.checkpointNs, row.checkpointNs),
            eq(graphCheckpointWrites.checkpointId, row.checkpointId),
          ),
        )
        .orderBy(asc(graphCheckpointWrites.taskId), asc(graphCheckpointWrites.idx)),
    ]);
    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
      writes.map(async (write) => [write.taskId, write.channel, await this.serde.loadsTyped(write.type, write.value)]),
    );
    return {
      config: { configurable: { ...key, checkpoint_id: row.checkpointId } },
      checkpoint,
      metadata,
      pendingWrites,
      ...(row.parentCheckpointId && { parentConfig: { configurable: { ...key, checkpoint_id: row.parentCheckpointId } } }),
    };
  }
}
