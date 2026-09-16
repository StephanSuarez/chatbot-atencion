ALTER TABLE "chatbot_config" ADD COLUMN "google_refresh_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "chatbot_config" ADD COLUMN "google_email" text;--> statement-breakpoint
ALTER TABLE "chatbot_config" ADD COLUMN "google_calendar_id" text;--> statement-breakpoint
ALTER TABLE "chatbot_config" ADD COLUMN "agenda_days" text;--> statement-breakpoint
ALTER TABLE "chatbot_config" ADD COLUMN "agenda_start" text;--> statement-breakpoint
ALTER TABLE "chatbot_config" ADD COLUMN "agenda_end" text;--> statement-breakpoint
ALTER TABLE "chatbot_config" ADD COLUMN "agenda_slot_minutes" integer;--> statement-breakpoint
ALTER TABLE "chatbot_config" ADD COLUMN "agenda_min_notice_hours" integer;