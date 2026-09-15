-- drizzle-kit no genera extensiones. En Supabase ya está activa (plan 002 §11); IF NOT EXISTS la vuelve inocua.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid,
	"document_id" uuid,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	CONSTRAINT "kb_chunks_one_source" CHECK (num_nonnulls("kb_chunks"."entry_id", "kb_chunks"."document_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "kb_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_documents_content_hash_unique" UNIQUE("content_hash"),
	CONSTRAINT "kb_documents_status" CHECK ("kb_documents"."status" in ('procesando', 'listo', 'no_se_pudo_leer'))
);
--> statement-breakpoint
CREATE TABLE "kb_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_entry_id_kb_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."kb_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE cascade ON UPDATE no action;