ALTER TABLE "settings" ADD COLUMN "default_quota_bytes" bigint;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "quota_bytes" bigint;