import { sql } from "drizzle-orm";
import { bigserial, boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, vector } from "drizzle-orm/pg-core";

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
  // Si la entrada se aprendió de una conversación (005) queda su origen; al borrarla, la entrada se conserva.
  learnedFromConversationId: uuid("learned_from_conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
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

// Conversaciones (004). Se guardan todas, con su origen; WhatsApp (007) y simulación (009) amplían el check.
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    origin: text("origin", { enum: ["chat_de_prueba"] }).notNull(),
    mode: text("mode", { enum: ["ia", "humano"] }).notNull().default("ia"),
    derived: boolean("derived").notNull().default(false),
    // Pedidos de "hablar con una persona" desde que está en modo IA (plan §4): lo cuenta el servidor.
    personRequests: integer("person_requests").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("conversations_origin", sql`${t.origin} in ('chat_de_prueba')`),
    check("conversations_mode", sql`${t.mode} in ('ia', 'humano')`),
  ],
);

// Una sola línea de tiempo: mensajes, notas del bot y cambios de modo (plan §6).
export const conversationEntries = pgTable(
  "conversation_entries",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    author: text("author", { enum: ["cliente", "bot", "equipo", "nota", "evento"] }).notNull(),
    text: text("text").notNull(),
    // Id que genera el navegador por mensaje: un reintento no lo duplica.
    clientMessageId: uuid("client_message_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("conversation_entries_author", sql`${t.author} in ('cliente', 'bot', 'equipo', 'nota', 'evento')`),
    index("conversation_entries_conversation").on(t.conversationId, t.seq),
  ],
);

// Propuestas de conocimiento (005): lo que el bot podría aprender de una conversación atendida por el
// equipo. Solo entran en la base de conocimiento cuando una persona las aprueba.
export const knowledgeProposals = pgTable(
  "knowledge_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // Vacíos si la redacción falló: la propuesta queda pendiente con su motivo para reintentar (FR-009).
    title: text("title"),
    content: text("content"),
    error: text("error"),
    status: text("status", { enum: ["pendiente", "aprobada", "descartada"] }).notNull().default("pendiente"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("knowledge_proposals_status", sql`${t.status} in ('pendiente', 'aprobada', 'descartada')`),
    // Una sola propuesta pendiente por conversación (FR-003), garantizado por la base.
    uniqueIndex("knowledge_proposals_una_pendiente")
      .on(t.conversationId)
      .where(sql`${t.status} = 'pendiente'`),
  ],
);
