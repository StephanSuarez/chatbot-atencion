import { db } from "./db";
import { chatbotConfig } from "./schema";

export type ConfigRow = typeof chatbotConfig.$inferSelect;
// Todos los campos son obligatorios (aunque sean null): guardar siempre reemplaza la fila completa.
export type ConfigValues = Required<Omit<typeof chatbotConfig.$inferInsert, "id" | "updatedAt">>;

export async function readConfig(): Promise<ConfigRow | null> {
  const [row] = await db.select().from(chatbotConfig);
  return row ?? null;
}

// Crea la fila en el primer guardado y la reemplaza en los siguientes, en una sola operación.
// Si dos personas guardan a la vez, gana la última (FR-012).
export async function saveConfig(values: ConfigValues): Promise<ConfigRow> {
  const row = { ...values, updatedAt: new Date() };
  const [saved] = await db
    .insert(chatbotConfig)
    .values(row)
    .onConflictDoUpdate({ target: chatbotConfig.id, set: row })
    .returning();
  return saved;
}
