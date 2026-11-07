ALTER TABLE "shares" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "require_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "per_visitor_folder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "max_file_bytes" bigint;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "max_files" integer;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "allowed_types" text[];