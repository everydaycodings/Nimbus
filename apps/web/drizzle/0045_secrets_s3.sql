CREATE TABLE "secret_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"env_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"minutes" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"expired_notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"env_id" uuid NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"changes" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE "secret_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"secret_id" uuid,
	"request_id" uuid,
	"author_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_required_keys" (
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text DEFAULT 'any' NOT NULL,
	"pattern" text,
	CONSTRAINT "secret_required_keys_project_id_key_pk" PRIMARY KEY("project_id","key")
);
--> statement-breakpoint
CREATE TABLE "secret_reviews" (
	"request_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"decision" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secret_reviews_request_id_user_id_pk" PRIMARY KEY("request_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "secret_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"label" text,
	"value_enc" text,
	"expires_at" timestamp with time zone NOT NULL,
	"max_views" integer DEFAULT 1 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"password_hash" text,
	"fails" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"first_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secret_shares_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "env" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "device" text;--> statement-breakpoint
ALTER TABLE "secret_envs" ADD COLUMN "protected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "secret_envs" ADD COLUMN "approvals_required" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "secret_envs" ADD COLUMN "approver_ids" text[];--> statement-breakpoint
ALTER TABLE "secret_envs" ADD COLUMN "admin_bypass" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "secret_tokens" ADD COLUMN "warned_days" integer;--> statement-breakpoint
ALTER TABLE "secret_versions" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "secret_versions" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "rotation_notified_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "secret_shares_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "secret_require_2fa" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "secret_max_idle_minutes" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "secret_unlock_max_hours" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "secret_trash_days" integer;--> statement-breakpoint
ALTER TABLE "secret_access_requests" ADD CONSTRAINT "secret_access_requests_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_requests" ADD CONSTRAINT "secret_access_requests_env_id_secret_envs_id_fk" FOREIGN KEY ("env_id") REFERENCES "public"."secret_envs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_requests" ADD CONSTRAINT "secret_access_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_access_requests" ADD CONSTRAINT "secret_access_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_change_requests" ADD CONSTRAINT "secret_change_requests_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_change_requests" ADD CONSTRAINT "secret_change_requests_env_id_secret_envs_id_fk" FOREIGN KEY ("env_id") REFERENCES "public"."secret_envs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_change_requests" ADD CONSTRAINT "secret_change_requests_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_change_requests" ADD CONSTRAINT "secret_change_requests_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_comments" ADD CONSTRAINT "secret_comments_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_comments" ADD CONSTRAINT "secret_comments_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_comments" ADD CONSTRAINT "secret_comments_request_id_secret_change_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."secret_change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_comments" ADD CONSTRAINT "secret_comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_required_keys" ADD CONSTRAINT "secret_required_keys_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_reviews" ADD CONSTRAINT "secret_reviews_request_id_secret_change_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."secret_change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_reviews" ADD CONSTRAINT "secret_reviews_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_shares" ADD CONSTRAINT "secret_shares_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "secret_access_project_idx" ON "secret_access_requests" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "secret_access_user_idx" ON "secret_access_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "secret_cr_project_idx" ON "secret_change_requests" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "secret_comments_secret_idx" ON "secret_comments" USING btree ("secret_id");--> statement-breakpoint
CREATE INDEX "secret_comments_request_idx" ON "secret_comments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "secret_shares_user_idx" ON "secret_shares" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_project_at_idx" ON "audit_events" USING btree ("project_id","at");