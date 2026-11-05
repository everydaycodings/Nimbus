CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "node_content" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"body" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED NOT NULL,
	"source" text NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_opens" (
	"user_id" text NOT NULL,
	"node_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_opens_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ocr_langs" text DEFAULT 'eng' NOT NULL;--> statement-breakpoint
ALTER TABLE "node_content" ADD CONSTRAINT "node_content_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_opens" ADD CONSTRAINT "node_opens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_opens" ADD CONSTRAINT "node_opens_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_content_tsv_idx" ON "node_content" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "node_opens_user_idx" ON "node_opens" USING btree ("user_id","opened_at");--> statement-breakpoint
CREATE INDEX "nodes_name_trgm_idx" ON "nodes" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
-- Recent starts from what was last changed, as it did before opens were kept.
INSERT INTO "node_opens" ("user_id", "node_id", "opened_at") SELECT "owner_id", "id", "updated_at" FROM "nodes" WHERE "trashed_at" IS NULL AND "vault_id" IS NULL;
