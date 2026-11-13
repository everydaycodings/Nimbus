CREATE TABLE "node_text_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"page" integer,
	"t_ms" integer,
	"box" jsonb,
	"body" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED NOT NULL
);--> statement-breakpoint
ALTER TABLE "node_text_parts" ADD CONSTRAINT "node_text_parts_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_text_parts_node_idx" ON "node_text_parts" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "node_text_parts_tsv_idx" ON "node_text_parts" USING gin ("tsv");--> statement-breakpoint
ALTER TABLE "node_content" ADD COLUMN "ocr_langs" text;--> statement-breakpoint
ALTER TABLE "node_content" ADD COLUMN "ocr_failed" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ocr_mode" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ocr_video_max_min" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "ocr_lang_status" jsonb DEFAULT '{}'::jsonb NOT NULL;
