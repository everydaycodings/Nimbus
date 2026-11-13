CREATE TABLE "secret_envs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"env_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_members" (
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secret_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "secret_overrides" (
	"secret_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"value_enc" text NOT NULL,
	CONSTRAINT "secret_overrides_secret_id_user_id_pk" PRIMARY KEY("secret_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "secret_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"wrapped_key" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"lock_minutes" integer DEFAULT 15 NOT NULL,
	"pin_hash" text,
	"fails" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "secret_tag_links" (
	"secret_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "secret_tag_links_secret_id_tag_id_pk" PRIMARY KEY("secret_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "secret_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_unlocks" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"unlocked_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"challenge" text,
	"challenge_expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "secret_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"value_enc" text NOT NULL,
	"comment" text,
	"type" text,
	"action" text NOT NULL,
	"changed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"env_id" uuid NOT NULL,
	"folder_id" uuid,
	"key" text NOT NULL,
	"value_enc" text NOT NULL,
	"comment" text,
	"type" text,
	"rotation_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "secrets_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "max_secret_projects_per_member" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "max_secrets_per_project" integer;--> statement-breakpoint
ALTER TABLE "secret_envs" ADD CONSTRAINT "secret_envs_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_folders" ADD CONSTRAINT "secret_folders_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_folders" ADD CONSTRAINT "secret_folders_env_id_secret_envs_id_fk" FOREIGN KEY ("env_id") REFERENCES "public"."secret_envs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_folders" ADD CONSTRAINT "secret_folders_parent_id_secret_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."secret_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_members" ADD CONSTRAINT "secret_members_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_members" ADD CONSTRAINT "secret_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_overrides" ADD CONSTRAINT "secret_overrides_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_overrides" ADD CONSTRAINT "secret_overrides_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_projects" ADD CONSTRAINT "secret_projects_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_settings" ADD CONSTRAINT "secret_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_tag_links" ADD CONSTRAINT "secret_tag_links_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_tag_links" ADD CONSTRAINT "secret_tag_links_tag_id_secret_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."secret_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_tags" ADD CONSTRAINT "secret_tags_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_unlocks" ADD CONSTRAINT "secret_unlocks_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_unlocks" ADD CONSTRAINT "secret_unlocks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_versions" ADD CONSTRAINT "secret_versions_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_versions" ADD CONSTRAINT "secret_versions_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_env_id_secret_envs_id_fk" FOREIGN KEY ("env_id") REFERENCES "public"."secret_envs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_folder_id_secret_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."secret_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "secret_envs_slug_idx" ON "secret_envs" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "secret_folders_env_idx" ON "secret_folders" USING btree ("env_id");--> statement-breakpoint
CREATE INDEX "secret_members_user_idx" ON "secret_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "secret_tags_name_idx" ON "secret_tags" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "secret_versions_secret_idx" ON "secret_versions" USING btree ("secret_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_root_key_idx" ON "secrets" USING btree ("env_id","key") WHERE "secrets"."folder_id" is null and "secrets"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_folder_key_idx" ON "secrets" USING btree ("env_id","folder_id","key") WHERE "secrets"."folder_id" is not null and "secrets"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "secrets_project_idx" ON "secrets" USING btree ("project_id");