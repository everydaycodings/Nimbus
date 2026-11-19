ALTER TABLE "s3_keys" ADD COLUMN "perms" text[] DEFAULT '{list,read,write,delete}' NOT NULL;--> statement-breakpoint
ALTER TABLE "s3_keys" ADD COLUMN "prefix" text;--> statement-breakpoint
ALTER TABLE "s3_keys" ADD COLUMN "allowed_ips" text[];--> statement-breakpoint
ALTER TABLE "s3_keys" ADD COLUMN "secret_prev_enc" text;--> statement-breakpoint
ALTER TABLE "s3_keys" ADD COLUMN "secret_prev_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "s3_keys" ADD COLUMN "rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "s3_keys" ADD COLUMN "rotate_every_days" integer;--> statement-breakpoint
ALTER TABLE "s3_keys" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "s3_keys" ADD COLUMN "rotate_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "s3_keys" ADD COLUMN "expiry_notified_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "s3_keys" SET "perms" = '{list,read}' WHERE "access" = 'ro';
