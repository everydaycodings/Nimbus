CREATE TABLE "registry_build_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"pattern" text NOT NULL,
	"tags" text[] NOT NULL,
	"dockerfile" text DEFAULT 'Dockerfile' NOT NULL,
	"context" text DEFAULT '.' NOT NULL,
	"build_args" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secret_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"platforms" text[] DEFAULT '{}' NOT NULL,
	"fail_on_critical" boolean DEFAULT false NOT NULL,
	"schedule" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_build_rules_type_check" CHECK ("registry_build_rules"."source_type" in ('branch', 'tag'))
);
--> statement-breakpoint
CREATE TABLE "registry_build_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"credential_enc" text,
	"webhook_secret_enc" text,
	"github_hook_id" bigint,
	"last_delivery_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_build_sources_repo_id_unique" UNIQUE("repo_id")
);
--> statement-breakpoint
CREATE TABLE "registry_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"rule_id" uuid,
	"trigger" text NOT NULL,
	"ref" text,
	"commit" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"digest" text,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"log_key" text,
	"log_tail" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "registry_builds_status_check" CHECK ("registry_builds"."status" in ('queued', 'waiting', 'running', 'success', 'failed', 'cancelled', 'stopped'))
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_builds" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_build_concurrency" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_build_timeout_min" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_build_preflight_ram_pct" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_build_min_disk_gb" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_build_guard_ram_pct" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_build_guard_disk_gb" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_cosign_enc" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_cosign_pub" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "registry_builds_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registry_build_rules" ADD CONSTRAINT "registry_build_rules_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_build_rules" ADD CONSTRAINT "registry_build_rules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_build_sources" ADD CONSTRAINT "registry_build_sources_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_builds" ADD CONSTRAINT "registry_builds_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_builds" ADD CONSTRAINT "registry_builds_rule_id_registry_build_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."registry_build_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_builds" ADD CONSTRAINT "registry_builds_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registry_build_rules_repo_idx" ON "registry_build_rules" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "registry_builds_repo_idx" ON "registry_builds" USING btree ("repo_id","created_at");