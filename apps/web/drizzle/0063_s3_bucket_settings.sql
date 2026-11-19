ALTER TABLE "s3_buckets" ADD COLUMN "quota_bytes" bigint;--> statement-breakpoint
ALTER TABLE "s3_buckets" ADD COLUMN "public_id" text;--> statement-breakpoint
ALTER TABLE "s3_buckets" ADD COLUMN "cors" jsonb;--> statement-breakpoint
ALTER TABLE "s3_buckets" ADD COLUMN "lifecycle" jsonb;--> statement-breakpoint
ALTER TABLE "s3_buckets" ADD COLUMN "lifecycle_last_run" jsonb;--> statement-breakpoint
ALTER TABLE "s3_buckets" ADD CONSTRAINT "s3_buckets_public_id_unique" UNIQUE("public_id");--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "s3_public_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "s3_default_quota" bigint;
