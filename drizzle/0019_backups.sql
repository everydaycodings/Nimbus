CREATE TABLE "backup_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_notes_kind_check" CHECK ("backup_notes"."kind" in ('note', 'pin', 'unpin'))
);
--> statement-breakpoint
CREATE TABLE "backup_objects" (
	"key" text PRIMARY KEY NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"encrypted" boolean NOT NULL,
	"copied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "backup_reauth" (
	"session_id" text PRIMARY KEY NOT NULL,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"verified_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"trigger" text NOT NULL,
	"source_run_id" uuid,
	"attempt" integer DEFAULT 1 NOT NULL,
	"actor_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"step" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"s3_key" text,
	"size_bytes" bigint,
	"sha256" text,
	"db_size_bytes" bigint,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fingerprint" jsonb,
	"diffs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"pinned" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"alerted_at" timestamp with time zone,
	CONSTRAINT "backup_runs_kind_check" CHECK ("backup_runs"."kind" in ('db', 'files')),
	CONSTRAINT "backup_runs_status_check" CHECK ("backup_runs"."status" in ('running', 'ok', 'warning', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_db_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_db_interval_h" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_db_start" text DEFAULT '03:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_files_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_files_interval_h" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_files_start" text DEFAULT '02:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_tz" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_retention" jsonb DEFAULT '{"days":30,"mode":"tiered","hours":48,"weeks":12,"months":12}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_files_grace_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_files_encrypt" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_files_concurrency" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_files_sample_pct" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_retry_attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_retry_delay_min" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_shrink_warn_pct" integer DEFAULT 20;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_alerts" text[] DEFAULT '{"failure","warning"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_provider" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_endpoint" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_region" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_bucket" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_folder" text DEFAULT 'nimbus' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_path_style" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_access_key" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_secret_key" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backup_mirror_at" text;--> statement-breakpoint
ALTER TABLE "backup_notes" ADD CONSTRAINT "backup_notes_run_id_backup_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."backup_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_notes" ADD CONSTRAINT "backup_notes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_reauth" ADD CONSTRAINT "backup_reauth_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_source_run_id_backup_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."backup_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_notes_run_idx" ON "backup_notes" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "backup_objects_gone_idx" ON "backup_objects" USING btree ("gone_at");--> statement-breakpoint
CREATE INDEX "backup_runs_kind_idx" ON "backup_runs" USING btree ("kind","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "backup_runs_one_running" ON "backup_runs" USING btree ("kind") WHERE "backup_runs"."status" = 'running';