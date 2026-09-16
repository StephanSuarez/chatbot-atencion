import { db } from "./db";
import { chatbotConfig } from "./schema";

export type ConfigRow = typeof chatbotConfig.$inferSelect;
// Guardar reemplaza estos campos por completo (aunque vayan en null). Lo de Google y el horario de
// atención no está aquí: se escribe desde lib/google/config.ts, para no pisarlo al guardar la configuración.
export type ConfigValues = Required<
  Pick<
    typeof chatbotConfig.$inferInsert,
    "companyName" | "prompt" | "provider" | "model" | "apiKeyEncrypted" | "apiKeyLast4"
  >
>;

export async function readConfig(): Promise<ConfigRow | null> {
  const [row] = await db.select().from(chatbotConfig);
  return row ?? null;
}

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
