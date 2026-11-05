ALTER TABLE "tags" DROP CONSTRAINT "tags_color_check";--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "sha256" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "upload_speed_bytes" bigint;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "derive_concurrency" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "derive_max_bytes" bigint DEFAULT 209715200 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "oidc_name" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "oidc_issuer" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "oidc_client_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "oidc_client_secret" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "oidc_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "upload_speed_bytes" bigint;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "storage_warned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "file_versions_sha256_idx" ON "file_versions" USING btree ("sha256") WHERE "file_versions"."sha256" is not null;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_color_check" CHECK ("tags"."color" in ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'teal', 'indigo', 'brown', 'gray'));