CREATE TABLE "chatbot_config" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"company_name" text NOT NULL,
	"prompt" text NOT NULL,
	"provider" text,
	"model" text,
	"api_key_encrypted" text,
	"api_key_last4" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatbot_config_single_row" CHECK (id = true)
);
