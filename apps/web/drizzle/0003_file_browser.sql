ALTER TABLE "settings" ADD COLUMN "trash_retention_days" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "nodes_unique_name_idx" ON "nodes" USING btree ("owner_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'),lower("name")) WHERE "nodes"."trashed_at" is null;--> statement-breakpoint
CREATE INDEX "nodes_owner_updated_idx" ON "nodes" USING btree ("owner_id","updated_at");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_trash_retention_positive" CHECK ("settings"."trash_retention_days" is null or "settings"."trash_retention_days" > 0);