CREATE TABLE "graph_checkpoint_writes" (
	"thread_id" text NOT NULL,
	"checkpoint_ns" text DEFAULT '' NOT NULL,
	"checkpoint_id" text NOT NULL,
	"task_id" text NOT NULL,
	"idx" integer NOT NULL,
	"channel" text NOT NULL,
	"type" text NOT NULL,
	"value" "bytea" NOT NULL,
	CONSTRAINT "graph_checkpoint_writes_thread_id_checkpoint_ns_checkpoint_id_task_id_idx_pk" PRIMARY KEY("thread_id","checkpoint_ns","checkpoint_id","task_id","idx")
);
--> statement-breakpoint
ALTER TABLE "graph_checkpoint_writes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "graph_checkpoints" (
	"thread_id" text NOT NULL,
	"checkpoint_ns" text DEFAULT '' NOT NULL,
	"checkpoint_id" text NOT NULL,
	"parent_checkpoint_id" text,
	"type" text NOT NULL,
	"checkpoint" "bytea" NOT NULL,
	"metadata_type" text NOT NULL,
	"metadata" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_checkpoints_thread_id_checkpoint_ns_checkpoint_id_pk" PRIMARY KEY("thread_id","checkpoint_ns","checkpoint_id")
);
--> statement-breakpoint
ALTER TABLE "graph_checkpoints" ENABLE ROW LEVEL SECURITY;