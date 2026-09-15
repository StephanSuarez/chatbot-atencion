CREATE TABLE "conversation_entries" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author" text NOT NULL,
	"text" text NOT NULL,
	"client_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_entries_client_message_id_unique" UNIQUE("client_message_id"),
	CONSTRAINT "conversation_entries_author" CHECK ("conversation_entries"."author" in ('cliente', 'bot', 'equipo', 'nota', 'evento'))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin" text NOT NULL,
	"mode" text DEFAULT 'ia' NOT NULL,
	"derived" boolean DEFAULT false NOT NULL,
	"person_requests" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_origin" CHECK ("conversations"."origin" in ('chat_de_prueba')),
	CONSTRAINT "conversations_mode" CHECK ("conversations"."mode" in ('ia', 'humano'))
);
--> statement-breakpoint
ALTER TABLE "conversation_entries" ADD CONSTRAINT "conversation_entries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_entries_conversation" ON "conversation_entries" USING btree ("conversation_id","seq");