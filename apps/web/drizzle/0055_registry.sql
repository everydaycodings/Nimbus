CREATE TABLE "registry_blobs" (
	"digest" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_hook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hook_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" integer,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_hooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"repo_id" uuid,
	"url" text NOT NULL,
	"secret_enc" text NOT NULL,
	"events" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_manifest_refs" (
	"manifest_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"digest" text NOT NULL,
	CONSTRAINT "registry_manifest_refs_manifest_id_kind_digest_pk" PRIMARY KEY("manifest_id","kind","digest")
);
--> statement-breakpoint
CREATE TABLE "registry_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"media_type" text NOT NULL,
	"artifact_type" text,
	"subject" text,
	"bytes" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"platforms" jsonb,
	"annotations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "registry_namespaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"quota_bytes" bigint,
	"policy" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_namespaces_kind_check" CHECK ("registry_namespaces"."kind" in ('user', 'org'))
);
--> statement-breakpoint
CREATE TABLE "registry_org_members" (
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_org_members_org_id_user_id_pk" PRIMARY KEY("org_id","user_id"),
	CONSTRAINT "registry_org_members_role_check" CHECK ("registry_org_members"."role" in ('owner', 'write', 'read'))
);
--> statement-breakpoint
CREATE TABLE "registry_orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_pulls_daily" (
	"repo_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "registry_pulls_daily_repo_id_tag_day_pk" PRIMARY KEY("repo_id","tag","day")
);
--> statement-breakpoint
CREATE TABLE "registry_repo_blobs" (
	"repo_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_repo_blobs_repo_id_digest_pk" PRIMARY KEY("repo_id","digest")
);
--> statement-breakpoint
CREATE TABLE "registry_repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"immutable_pattern" text,
	"policy" jsonb,
	"readme" text,
	"block_critical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "registry_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manifest_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"critical" integer DEFAULT 0 NOT NULL,
	"high" integer DEFAULT 0 NOT NULL,
	"medium" integer DEFAULT 0 NOT NULL,
	"low" integer DEFAULT 0 NOT NULL,
	"report" jsonb,
	"error" text,
	"scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"name" text NOT NULL,
	"digest" text NOT NULL,
	"pushed_by" text,
	"pushed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_pulled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "registry_token_repos" (
	"token_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	CONSTRAINT "registry_token_repos_token_id_repo_id_pk" PRIMARY KEY("token_id","repo_id")
);
--> statement-breakpoint
CREATE TABLE "registry_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"secret_enc" text NOT NULL,
	"access" text NOT NULL,
	"all_repos" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_ip" text,
	CONSTRAINT "registry_tokens_prefix_unique" UNIQUE("prefix"),
	CONSTRAINT "registry_tokens_access_check" CHECK ("registry_tokens"."access" in ('pull', 'push'))
);
--> statement-breakpoint
CREATE TABLE "registry_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"s3_key" text NOT NULL,
	"s3_upload_id" text NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"offset" bigint DEFAULT 0 NOT NULL,
	"hash_state" text,
	"tail_key" text,
	"tail_size" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_upstreams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"username" text,
	"password_enc" text,
	"ttl_days" integer DEFAULT 30 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_upstreams_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_public" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_redirect" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_rps_limit" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_bps_limit" bigint;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_org_create" text DEFAULT 'anyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_default_quota_bytes" bigint;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "registry_scan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "registry_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registry_hook_deliveries" ADD CONSTRAINT "registry_hook_deliveries_hook_id_registry_hooks_id_fk" FOREIGN KEY ("hook_id") REFERENCES "public"."registry_hooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_hooks" ADD CONSTRAINT "registry_hooks_namespace_id_registry_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."registry_namespaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_hooks" ADD CONSTRAINT "registry_hooks_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_manifest_refs" ADD CONSTRAINT "registry_manifest_refs_manifest_id_registry_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."registry_manifests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_manifests" ADD CONSTRAINT "registry_manifests_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_org_members" ADD CONSTRAINT "registry_org_members_org_id_registry_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."registry_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_org_members" ADD CONSTRAINT "registry_org_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_orgs" ADD CONSTRAINT "registry_orgs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_pulls_daily" ADD CONSTRAINT "registry_pulls_daily_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_repo_blobs" ADD CONSTRAINT "registry_repo_blobs_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_repo_blobs" ADD CONSTRAINT "registry_repo_blobs_digest_registry_blobs_digest_fk" FOREIGN KEY ("digest") REFERENCES "public"."registry_blobs"("digest") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_repos" ADD CONSTRAINT "registry_repos_namespace_id_registry_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."registry_namespaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_scans" ADD CONSTRAINT "registry_scans_manifest_id_registry_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."registry_manifests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_tags" ADD CONSTRAINT "registry_tags_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_tags" ADD CONSTRAINT "registry_tags_pushed_by_user_id_fk" FOREIGN KEY ("pushed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_token_repos" ADD CONSTRAINT "registry_token_repos_token_id_registry_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."registry_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_token_repos" ADD CONSTRAINT "registry_token_repos_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_tokens" ADD CONSTRAINT "registry_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_uploads" ADD CONSTRAINT "registry_uploads_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_uploads" ADD CONSTRAINT "registry_uploads_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registry_hook_deliveries_hook_idx" ON "registry_hook_deliveries" USING btree ("hook_id","created_at");--> statement-breakpoint
CREATE INDEX "registry_hooks_ns_idx" ON "registry_hooks" USING btree ("namespace_id");--> statement-breakpoint
CREATE INDEX "registry_manifest_refs_digest_idx" ON "registry_manifest_refs" USING btree ("digest");--> statement-breakpoint
CREATE UNIQUE INDEX "registry_manifests_repo_digest_idx" ON "registry_manifests" USING btree ("repo_id","digest");--> statement-breakpoint
CREATE INDEX "registry_manifests_subject_idx" ON "registry_manifests" USING btree ("repo_id","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "registry_namespaces_name_idx" ON "registry_namespaces" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "registry_namespaces_ref_idx" ON "registry_namespaces" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "registry_org_members_user_idx" ON "registry_org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "registry_repo_blobs_digest_idx" ON "registry_repo_blobs" USING btree ("digest");--> statement-breakpoint
CREATE UNIQUE INDEX "registry_repos_ns_name_idx" ON "registry_repos" USING btree ("namespace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "registry_scans_manifest_idx" ON "registry_scans" USING btree ("manifest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registry_tags_repo_name_idx" ON "registry_tags" USING btree ("repo_id","name") WHERE "registry_tags"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "registry_tags_repo_digest_idx" ON "registry_tags" USING btree ("repo_id","digest");--> statement-breakpoint
CREATE INDEX "registry_tokens_user_idx" ON "registry_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "registry_uploads_repo_idx" ON "registry_uploads" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "registry_uploads_updated_idx" ON "registry_uploads" USING btree ("updated_at");