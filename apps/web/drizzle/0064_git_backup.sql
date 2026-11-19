CREATE TABLE "git_backup_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"account" text,
	"host" text,
	"via" text DEFAULT 'pat' NOT NULL,
	"secret_enc" text NOT NULL,
	"last4" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone,
	"warned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "git_backup_connections_provider_check" CHECK ("git_backup_connections"."provider" in ('github', 'gitlab', 'gitea'))
);
--> statement-breakpoint
CREATE TABLE "git_backup_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"connection_id" uuid,
	"registry_connection_id" uuid,
	"dest_kind" text NOT NULL,
	"bucket_id" uuid,
	"key_id" uuid,
	"s3_endpoint" text,
	"s3_region" text,
	"s3_bucket" text,
	"s3_access_key" text,
	"s3_secret_enc" text,
	"s3_path_style" boolean DEFAULT true NOT NULL,
	"prefix" text DEFAULT 'git-backup' NOT NULL,
	"interval_min" integer DEFAULT 60 NOT NULL,
	"keep_last" integer DEFAULT 10 NOT NULL,
	"lfs" boolean DEFAULT true NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"auto_owners" text[] DEFAULT '{}' NOT NULL,
	"webhook_enabled" boolean DEFAULT false NOT NULL,
	"webhook_secret_enc" text,
	"fail_streak" integer DEFAULT 0 NOT NULL,
	"alerted_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "git_backup_jobs_dest_check" CHECK ("git_backup_jobs"."dest_kind" in ('nimbus', 's3')),
	CONSTRAINT "git_backup_jobs_conn_check" CHECK (("git_backup_jobs"."connection_id" is null) <> ("git_backup_jobs"."registry_connection_id" is null))
);
--> statement-breakpoint
CREATE TABLE "git_backup_repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"clone_url" text NOT NULL,
	"private" boolean DEFAULT true NOT NULL,
	"interval_min" integer,
	"auto_added" boolean DEFAULT false NOT NULL,
	"refs_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"last_backup_at" timestamp with time zone,
	"next_due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "git_backup_repos_status_check" CHECK ("git_backup_repos"."status" in ('pending', 'ok', 'error', 'gone'))
);
--> statement-breakpoint
CREATE TABLE "git_backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"force" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"checked" integer DEFAULT 0 NOT NULL,
	"changed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "git_backup_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"run_id" uuid,
	"key" text NOT NULL,
	"sha" text NOT NULL,
	"refs" integer DEFAULT 0 NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"lfs" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "git_backup_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "git_backup_min_interval" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "git_backup_concurrency" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "github_oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "github_oauth_client_secret" text;--> statement-breakpoint
ALTER TABLE "git_backup_connections" ADD CONSTRAINT "git_backup_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_backup_jobs" ADD CONSTRAINT "git_backup_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_backup_jobs" ADD CONSTRAINT "git_backup_jobs_connection_id_git_backup_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."git_backup_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_backup_jobs" ADD CONSTRAINT "git_backup_jobs_registry_connection_id_registry_git_connections_id_fk" FOREIGN KEY ("registry_connection_id") REFERENCES "public"."registry_git_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_backup_jobs" ADD CONSTRAINT "git_backup_jobs_bucket_id_s3_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."s3_buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_backup_jobs" ADD CONSTRAINT "git_backup_jobs_key_id_s3_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."s3_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_backup_repos" ADD CONSTRAINT "git_backup_repos_job_id_git_backup_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."git_backup_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_backup_runs" ADD CONSTRAINT "git_backup_runs_job_id_git_backup_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."git_backup_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_backup_snapshots" ADD CONSTRAINT "git_backup_snapshots_repo_id_git_backup_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."git_backup_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "git_backup_connections_name_idx" ON "git_backup_connections" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "git_backup_jobs_user_idx" ON "git_backup_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_backup_repos_job_repo_idx" ON "git_backup_repos" USING btree ("job_id",lower("owner"),lower("name"));--> statement-breakpoint
CREATE INDEX "git_backup_repos_due_idx" ON "git_backup_repos" USING btree ("next_due_at");--> statement-breakpoint
CREATE INDEX "git_backup_runs_job_idx" ON "git_backup_runs" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "git_backup_snapshots_repo_idx" ON "git_backup_snapshots" USING btree ("repo_id","created_at");
