CREATE TABLE "file_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"s3_key" text NOT NULL,
	"size" bigint NOT NULL,
	"mime" text,
	"upload_id" text,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_versions_upload_id_unique" UNIQUE("upload_id")
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "max_upload_bytes" bigint;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "blocked_extensions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "version_keep_last" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "version_max_age_days" integer;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_versions_node_id_idx" ON "file_versions" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "file_versions_s3_key_idx" ON "file_versions" USING btree ("s3_key");--> statement-breakpoint
-- Every existing file starts with one version: what it holds now.
INSERT INTO "file_versions" ("node_id", "s3_key", "size", "mime", "uploaded_by", "created_at")
SELECT "id", "s3_key", "size", "mime", "owner_id", "updated_at" FROM "nodes" WHERE "kind" = 'file';
