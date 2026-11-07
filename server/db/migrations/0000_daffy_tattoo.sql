CREATE TABLE IF NOT EXISTS "search_lease" (
	"id" integer PRIMARY KEY NOT NULL,
	"owner" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_records" (
	"kind" text NOT NULL,
	"id" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "workspace_records_kind_id_pk" PRIMARY KEY("kind","id")
);
