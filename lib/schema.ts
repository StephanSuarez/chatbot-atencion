import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// Drizzle 0.45 no trae un tipo para bytes: se declara a mano. El driver los devuelve como Buffer.
// El genérico se fija a ArrayBuffer porque es lo que `fromDriver` construye de verdad; con el genérico
// por defecto (que admite memoria compartida) los bytes no se aceptan como cuerpo de una respuesta HTTP.
const bytea = customType<{ data: Uint8Array<ArrayBuffer>; driverData: Buffer }>({
  dataType: () => "bytea",
  fromDriver: (value) => new Uint8Array(value),
});

// Todas las tablas llevan RLS sin políticas: en Supabase quedan cerradas a su Data API, que la app no usa.
// La app se conecta como `postgres`, que salta RLS (rolbypassrls, verificado en Supabase el 2026-09-16).

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
    // Cuenta de Google conectada (006). El permiso se guarda cifrado igual que la API key.
    googleRefreshTokenEncrypted: text("google_refresh_token_encrypted"),
    googleEmail: text("google_email"),
    googleCalendarId: text("google_calendar_id"),
    // Horario de atención para las citas: sin esto el bot no agenda (FR-005).
    agendaDays: text("agenda_days"),
    agendaStart: text("agenda_start"),
    agendaEnd: text("agenda_end"),
    agendaSlotMinutes: integer("agenda_slot_minutes"),
    agendaMinNoticeHours: integer("agenda_min_notice_hours"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check("chatbot_config_single_row", sql`id = true`)],
).enableRLS();

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
}).enableRLS();

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
).enableRLS();

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
).enableRLS();

// Conversaciones (004). Se guardan todas, con su origen; WhatsApp (007) y simulación (009) amplían el check.
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    origin: text("origin", { enum: ["chat_de_prueba", "simulacion"] }).notNull(),
    mode: text("mode", { enum: ["ia", "humano"] }).notNull().default("ia"),
    derived: boolean("derived").notNull().default(false),
    // Motivo de la derivación (008): antes solo estaba dentro del texto del evento.
    // «adjunto» (010) lo decide el código, no el modelo. Es solo el tipo: la columna es texto, sin check.
    handoffReason: text("handoff_reason", { enum: ["no_sabe", "enojo", "pide_persona", "adjunto"] }),
    // Pedidos de "hablar con una persona" desde que está en modo IA (plan §4): lo cuenta el servidor.
    personRequests: integer("person_requests").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("conversations_origin", sql`${t.origin} in ('chat_de_prueba', 'simulacion')`),
    check("conversations_mode", sql`${t.mode} in ('ia', 'humano')`),
  ],
).enableRLS();

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
).enableRLS();

/**
 * Adjunto de un mensaje (010). En tabla aparte y no como columnas de `conversation_entries` porque esas
 * filas se consultan cada pocos segundos: los bytes no pueden viajar en ese camino (plan 010 §5).
 */
export const conversationAttachments = pgTable(
  "conversation_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Único: un adjunto por mensaje (FR-001). Se borra con su mensaje, y este con su conversación.
    entrySeq: bigint("entry_seq", { mode: "number" })
      .notNull()
      .unique()
      .references(() => conversationEntries.seq, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category", { enum: ["imagen", "audio", "documento"] }).notNull(),
    // El tipo que impone el servidor al servir, nunca el que declaró quien subió el archivo.
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("conversation_attachments_category", sql`${t.category} in ('imagen', 'audio', 'documento')`),
  ],
).enableRLS();

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
).enableRLS();

// Simulaciones (009): preguntas de prueba, ejecuciones y sus resultados.
export const simulationQuestions = pgTable(
  "simulation_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    text: text("text").notNull(),
    expectation: text("expectation", { enum: ["responde", "deriva", "ninguna"] }).notNull().default("ninguna"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("simulation_questions_expectation", sql`${t.expectation} in ('responde', 'deriva', 'ninguna')`)],
).enableRLS();

export const simulations = pgTable(
  "simulations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: text("status", { enum: ["en_curso", "terminada", "interrumpida"] }).notNull().default("en_curso"),
    total: integer("total").notNull(),
    done: integer("done").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("simulations_status", sql`${t.status} in ('en_curso', 'terminada', 'interrumpida')`)],
).enableRLS();

export const simulationResults = pgTable("simulation_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  simulationId: uuid("simulation_id")
    .notNull()
    .references(() => simulations.id, { onDelete: "cascade" }),
  // El texto se copia: el informe tiene que seguir siendo legible si luego se edita o borra la pregunta.
  question: text("question").notNull(),
  expectation: text("expectation", { enum: ["responde", "deriva", "ninguna"] }).notNull(),
  answer: text("answer"),
  derived: boolean("derived").notNull().default(false),
  met: boolean("met"),
  error: text("error"),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// Checkpoints de LangGraph (011): el estado del turno del bot después de cada nodo. Un hilo por mensaje del
// cliente, que se borra al terminar el turno (plan 011 §5). Los bytes son del serializador de LangGraph.
export const graphCheckpoints = pgTable(
  "graph_checkpoints",
  {
    threadId: text("thread_id").notNull(),
    checkpointNs: text("checkpoint_ns").notNull().default(""),
    checkpointId: text("checkpoint_id").notNull(),
    parentCheckpointId: text("parent_checkpoint_id"),
    type: text("type").notNull(),
    checkpoint: bytea("checkpoint").notNull(),
    metadataType: text("metadata_type").notNull(),
    metadata: bytea("metadata").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.checkpointNs, t.checkpointId] })],
).enableRLS();

// Escrituras pendientes de un checkpoint: lo que un nodo ya produjo cuando otro falló en el mismo paso.
export const graphCheckpointWrites = pgTable(
  "graph_checkpoint_writes",
  {
    threadId: text("thread_id").notNull(),
    checkpointNs: text("checkpoint_ns").notNull().default(""),
    checkpointId: text("checkpoint_id").notNull(),
    taskId: text("task_id").notNull(),
    idx: integer("idx").notNull(),
    channel: text("channel").notNull(),
    type: text("type").notNull(),
    value: bytea("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.checkpointNs, t.checkpointId, t.taskId, t.idx] })],
).enableRLS();
