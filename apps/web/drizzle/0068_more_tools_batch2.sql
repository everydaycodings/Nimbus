CREATE TABLE "archive_cookies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"domain" text NOT NULL,
	"value_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"site" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"folder_node_id" uuid,
	"interval_min" integer,
	"next_due_at" timestamp with time zone,
	"cookie_domain" text,
	"last_status" text,
	"last_error" text,
	"last_run_at" timestamp with time zone,
	"running_at" timestamp with time zone,
	"fail_streak" integer DEFAULT 0 NOT NULL,
	"alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"folder_node_id" uuid
);
--> statement-breakpoint
CREATE TABLE "archive_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"text_hash" text NOT NULL,
	"html_node_id" uuid,
	"pdf_node_id" uuid,
	"png_node_id" uuid,
	"text_node_id" uuid,
	"bytes" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "convert_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"eta_sec" integer,
	"input_node_id" uuid,
	"input_name" text NOT NULL,
	"output_node_id" uuid,
	"output_name" text,
	"preset_name" text NOT NULL,
	"preset" jsonb NOT NULL,
	"seconds" integer,
	"watch_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "convert_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"preset" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "convert_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"folder_node_id" uuid NOT NULL,
	"preset_name" text NOT NULL,
	"preset" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"account" text,
	"root" text DEFAULT '' NOT NULL,
	"config_enc" text NOT NULL,
	"last_checked" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"source_path" text NOT NULL,
	"source_id" text,
	"node_id" uuid,
	"size" bigint DEFAULT 0 NOT NULL,
	"mtime" timestamp with time zone,
	"status" text NOT NULL,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'rclone' NOT NULL,
	"connection_id" uuid,
	"sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"target_node_id" uuid,
	"options" jsonb NOT NULL,
	"interval_min" integer,
	"paused" boolean DEFAULT false NOT NULL,
	"est_files" integer,
	"est_bytes" bigint,
	"fail_streak" integer DEFAULT 0 NOT NULL,
	"alerted_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"next_due_at" timestamp with time zone,
	"done_notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"files_total" integer DEFAULT 0 NOT NULL,
	"files_done" integer DEFAULT 0 NOT NULL,
	"files_skipped" integer DEFAULT 0 NOT NULL,
	"files_failed" integer DEFAULT 0 NOT NULL,
	"bytes_total" bigint DEFAULT 0 NOT NULL,
	"bytes_done" bigint DEFAULT 0 NOT NULL,
	"errors" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "registry_mirrors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"upstream" text NOT NULL,
	"tags" text DEFAULT 'latest' NOT NULL,
	"cap" integer DEFAULT 5 NOT NULL,
	"target_repo_id" uuid NOT NULL,
	"username" text,
	"password_enc" text,
	"interval_min" integer DEFAULT 1440 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_digests" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"fail_streak" integer DEFAULT 0 NOT NULL,
	"alerted_at" timestamp with time zone,
	"next_due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"repo_id" uuid,
	"pattern" text,
	"keep_last" integer,
	"older_than_days" integer,
	"keep_regex" text,
	"delete_untagged" boolean DEFAULT false NOT NULL,
	"interval_min" integer DEFAULT 1440 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"fail_streak" integer DEFAULT 0 NOT NULL,
	"alerted_at" timestamp with time zone,
	"next_due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_rules_scope_check" CHECK (("registry_rules"."repo_id" is null) <> ("registry_rules"."pattern" is null))
);
--> statement-breakpoint
CREATE TABLE "registry_tool_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"label" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"changed" integer DEFAULT 0 NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "server_backup_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"host" text DEFAULT '' NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"username" text DEFAULT 'root' NOT NULL,
	"private_key_enc" text,
	"public_key" text,
	"host_key" text,
	"mode" text DEFAULT 'ssh' NOT NULL,
	"agent_token_hash" text,
	"is_self" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_backup_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"host_id" uuid NOT NULL,
	"name" text NOT NULL,
	"paths" text[] DEFAULT '{}'::text[] NOT NULL,
	"excludes" text[] DEFAULT '{}'::text[] NOT NULL,
	"volumes" text[] DEFAULT '{}'::text[] NOT NULL,
	"stop_containers" boolean DEFAULT false NOT NULL,
	"pre_hook" text DEFAULT '' NOT NULL,
	"post_hook" text DEFAULT '' NOT NULL,
	"dest_kind" text NOT NULL,
	"bucket_id" uuid,
	"key_id" uuid,
	"s3_endpoint" text,
	"s3_region" text,
	"s3_bucket" text,
	"s3_access_key" text,
	"s3_secret_enc" text,
	"s3_path_style" boolean DEFAULT true NOT NULL,
	"prefix" text DEFAULT 'server-backup' NOT NULL,
	"restic_password_enc" text NOT NULL,
	"retention" jsonb DEFAULT '{"daily":7,"weekly":4,"monthly":12}'::jsonb NOT NULL,
	"interval_min" integer DEFAULT 1440 NOT NULL,
	"next_due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"fail_streak" integer DEFAULT 0 NOT NULL,
	"alerted_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_backup_jobs_dest_check" CHECK ("server_backup_jobs"."dest_kind" in ('nimbus', 's3'))
);
--> statement-breakpoint
CREATE TABLE "server_backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"progress" double precision,
	"stage" text DEFAULT 'starting' NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"files" bigint DEFAULT 0 NOT NULL,
	"snapshot_id" text,
	"error" text,
	"log_tail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "server_backup_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"restic_id" text NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'tar' NOT NULL,
	"paths" text[] DEFAULT '{}'::text[] NOT NULL,
	"bytes" bigint,
	"added_bytes" bigint
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_tools_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "archiver_tool_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "archiver_browser_url" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "convert_tool_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "convert_concurrency" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "convert_max_bytes" bigint;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "convert_max_seconds" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "convert_daily_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "convert_hwaccel" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "import_tool_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "import_google_client_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "import_google_client_secret" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "import_dropbox_client_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "import_dropbox_client_secret" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "import_onedrive_client_id" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "import_onedrive_client_secret" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "server_backup_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "server_backup_members" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "server_backup_min_interval" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_cookies" ADD CONSTRAINT "archive_cookies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_pages" ADD CONSTRAINT "archive_pages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_pages" ADD CONSTRAINT "archive_pages_folder_node_id_nodes_id_fk" FOREIGN KEY ("folder_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_prefs" ADD CONSTRAINT "archive_prefs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_prefs" ADD CONSTRAINT "archive_prefs_folder_node_id_nodes_id_fk" FOREIGN KEY ("folder_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_snapshots" ADD CONSTRAINT "archive_snapshots_page_id_archive_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."archive_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_snapshots" ADD CONSTRAINT "archive_snapshots_html_node_id_nodes_id_fk" FOREIGN KEY ("html_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_snapshots" ADD CONSTRAINT "archive_snapshots_pdf_node_id_nodes_id_fk" FOREIGN KEY ("pdf_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_snapshots" ADD CONSTRAINT "archive_snapshots_png_node_id_nodes_id_fk" FOREIGN KEY ("png_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_snapshots" ADD CONSTRAINT "archive_snapshots_text_node_id_nodes_id_fk" FOREIGN KEY ("text_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convert_jobs" ADD CONSTRAINT "convert_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convert_jobs" ADD CONSTRAINT "convert_jobs_input_node_id_nodes_id_fk" FOREIGN KEY ("input_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convert_jobs" ADD CONSTRAINT "convert_jobs_output_node_id_nodes_id_fk" FOREIGN KEY ("output_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convert_presets" ADD CONSTRAINT "convert_presets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convert_watches" ADD CONSTRAINT "convert_watches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convert_watches" ADD CONSTRAINT "convert_watches_folder_node_id_nodes_id_fk" FOREIGN KEY ("folder_node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_connections" ADD CONSTRAINT "import_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_connection_id_import_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."import_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_target_node_id_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_mirrors" ADD CONSTRAINT "registry_mirrors_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_mirrors" ADD CONSTRAINT "registry_mirrors_target_repo_id_registry_repos_id_fk" FOREIGN KEY ("target_repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_rules" ADD CONSTRAINT "registry_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_rules" ADD CONSTRAINT "registry_rules_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_tool_runs" ADD CONSTRAINT "registry_tool_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_backup_hosts" ADD CONSTRAINT "server_backup_hosts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_backup_jobs" ADD CONSTRAINT "server_backup_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_backup_jobs" ADD CONSTRAINT "server_backup_jobs_host_id_server_backup_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."server_backup_hosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_backup_jobs" ADD CONSTRAINT "server_backup_jobs_bucket_id_s3_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."s3_buckets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_backup_jobs" ADD CONSTRAINT "server_backup_jobs_key_id_s3_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."s3_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_backup_runs" ADD CONSTRAINT "server_backup_runs_job_id_server_backup_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."server_backup_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_backup_snapshots" ADD CONSTRAINT "server_backup_snapshots_job_id_server_backup_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."server_backup_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "archive_cookies_user_domain_idx" ON "archive_cookies" USING btree ("user_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "archive_pages_user_url_idx" ON "archive_pages" USING btree ("user_id","url");--> statement-breakpoint
CREATE INDEX "archive_pages_due_idx" ON "archive_pages" USING btree ("next_due_at");--> statement-breakpoint
CREATE INDEX "archive_snapshots_page_idx" ON "archive_snapshots" USING btree ("page_id","captured_at");--> statement-breakpoint
CREATE INDEX "convert_jobs_user_idx" ON "convert_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "convert_jobs_input_idx" ON "convert_jobs" USING btree ("input_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "convert_presets_user_name_idx" ON "convert_presets" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "convert_watches_folder_preset_idx" ON "convert_watches" USING btree ("folder_node_id","preset_name");--> statement-breakpoint
CREATE UNIQUE INDEX "import_connections_label_idx" ON "import_connections" USING btree ("user_id",lower("label"));--> statement-breakpoint
CREATE UNIQUE INDEX "import_items_path_idx" ON "import_items" USING btree ("job_id","source_path");--> statement-breakpoint
CREATE INDEX "import_items_node_idx" ON "import_items" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "import_jobs_user_idx" ON "import_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "import_jobs_due_idx" ON "import_jobs" USING btree ("next_due_at");--> statement-breakpoint
CREATE INDEX "import_runs_job_idx" ON "import_runs" USING btree ("job_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_runs_one_running_idx" ON "import_runs" USING btree ("job_id") WHERE "import_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "registry_mirrors_user_idx" ON "registry_mirrors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "registry_mirrors_due_idx" ON "registry_mirrors" USING btree ("next_due_at");--> statement-breakpoint
CREATE INDEX "registry_rules_user_idx" ON "registry_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "registry_rules_due_idx" ON "registry_rules" USING btree ("next_due_at");--> statement-breakpoint
CREATE INDEX "registry_tool_runs_user_idx" ON "registry_tool_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "registry_tool_runs_one_running_idx" ON "registry_tool_runs" USING btree ("ref_id") WHERE "registry_tool_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "server_backup_hosts_user_idx" ON "server_backup_hosts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_backup_hosts_label_idx" ON "server_backup_hosts" USING btree ("user_id",lower("label"));--> statement-breakpoint
CREATE UNIQUE INDEX "server_backup_hosts_agent_idx" ON "server_backup_hosts" USING btree ("agent_token_hash") WHERE "server_backup_hosts"."agent_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "server_backup_jobs_user_idx" ON "server_backup_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "server_backup_jobs_due_idx" ON "server_backup_jobs" USING btree ("next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "server_backup_jobs_name_idx" ON "server_backup_jobs" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "server_backup_runs_job_idx" ON "server_backup_runs" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "server_backup_runs_one_running_idx" ON "server_backup_runs" USING btree ("job_id") WHERE "server_backup_runs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "server_backup_snapshots_idx" ON "server_backup_snapshots" USING btree ("job_id","restic_id");--> statement-breakpoint
CREATE INDEX "server_backup_snapshots_time_idx" ON "server_backup_snapshots" USING btree ("job_id","taken_at");