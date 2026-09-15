import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";

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

// Base de conocimiento (002). Todo pertenece a la única configuración, así que no hay FK a chatbot_config.
export const kbEntries = pgTable("kb_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kbDocuments = pgTable(
  "kb_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    contentHash: text("content_hash").notNull().unique(),
    status: text("status", { enum: ["procesando", "listo", "no_se_pudo_leer"] }).notNull(),
    error: text("error"),
    text: text("text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("kb_documents_status", sql`${t.status} in ('procesando', 'listo', 'no_se_pudo_leer')`)],
);

// text-embedding-3-small (plan 002 §4). Cambiar de modelo = cambiar esta dimensión y reindexar.
export const EMBEDDING_DIMENSIONS = 1536;

export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id").references(() => kbEntries.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => kbDocuments.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    // Vacío mientras está pendiente de indexar; embeddingModel dice con qué modelo se calculó.
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text("embedding_model"),
  },
  (t) => [check("kb_chunks_one_source", sql`num_nonnulls(${t.entryId}, ${t.documentId}) = 1`)],
);
