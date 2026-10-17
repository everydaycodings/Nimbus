ALTER TABLE "file_versions" ADD COLUMN "number" integer;--> statement-breakpoint
UPDATE "file_versions" v SET "number" = r.n FROM (
  SELECT id, row_number() OVER (PARTITION BY node_id ORDER BY created_at, id) AS n FROM "file_versions"
) r WHERE r.id = v.id;--> statement-breakpoint
ALTER TABLE "file_versions" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "keep" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "current_version_id" uuid;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_current_version_id_file_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."file_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Until now the newest version was the current one.
UPDATE "nodes" n SET "current_version_id" = v.id FROM (
  SELECT DISTINCT ON (node_id) node_id, id FROM "file_versions" ORDER BY node_id, created_at DESC, id DESC
) v WHERE v.node_id = n.id;--> statement-breakpoint
CREATE UNIQUE INDEX "file_versions_node_number_idx" ON "file_versions" USING btree ("node_id","number");
