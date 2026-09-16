CREATE TABLE "conversation_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_seq" bigint NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_attachments_entry_seq_unique" UNIQUE("entry_seq"),
	CONSTRAINT "conversation_attachments_category" CHECK ("conversation_attachments"."category" in ('imagen', 'audio', 'documento'))
);
--> statement-breakpoint
ALTER TABLE "conversation_attachments" ADD CONSTRAINT "conversation_attachments_entry_seq_conversation_entries_seq_fk" FOREIGN KEY ("entry_seq") REFERENCES "public"."conversation_entries"("seq") ON DELETE cascade ON UPDATE no action;