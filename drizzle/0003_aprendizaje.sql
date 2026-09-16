CREATE TABLE "knowledge_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"title" text,
	"content" text,
	"error" text,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_proposals_status" CHECK ("knowledge_proposals"."status" in ('pendiente', 'aprobada', 'descartada'))
);
--> statement-breakpoint
ALTER TABLE "kb_entries" ADD COLUMN "learned_from_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_proposals" ADD CONSTRAINT "knowledge_proposals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_proposals_una_pendiente" ON "knowledge_proposals" USING btree ("conversation_id") WHERE "knowledge_proposals"."status" = 'pendiente';--> statement-breakpoint
ALTER TABLE "kb_entries" ADD CONSTRAINT "kb_entries_learned_from_conversation_id_conversations_id_fk" FOREIGN KEY ("learned_from_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;