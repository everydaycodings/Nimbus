ALTER TABLE "file_versions" ADD COLUMN "enc_key" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "vaults_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "max_vaults_per_member" integer;--> statement-breakpoint
ALTER TABLE "vaults" ADD COLUMN "kdf_memory" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "vaults" ADD COLUMN "recovery_wrapped_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "vault_lock_minutes" integer DEFAULT 15 NOT NULL;