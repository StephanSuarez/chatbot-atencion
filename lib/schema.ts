import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Única configuración del chatbot (FR-001): la base garantiza una sola fila (id siempre true).
export const chatbotConfig = pgTable(
  "chatbot_config",
  {
    id: boolean("id").primaryKey().default(true),
    companyName: text("company_name").notNull(),
    prompt: text("prompt").notNull(),
    provider: text("provider"),
    model: text("model"),
    // Cifrada con AES-256-GCM (lib/crypto.ts); los últimos 4 caracteres van aparte para enmascarar sin descifrar.
    apiKeyEncrypted: text("api_key_encrypted"),
    apiKeyLast4: text("api_key_last4"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check("chatbot_config_single_row", sql`id = true`)],
);
