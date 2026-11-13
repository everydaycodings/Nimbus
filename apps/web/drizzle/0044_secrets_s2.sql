CREATE TABLE "secret_cli_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_ip" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "secret_cli_tokens_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "secret_device_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"poll_hash" text NOT NULL,
	"device_name" text NOT NULL,
	"ip" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secret_device_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "secret_device_codes_poll_hash_unique" UNIQUE("poll_hash")
);
--> statement-breakpoint
CREATE TABLE "secret_push_targets" (
	"env_id" uuid PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"username" text NOT NULL,
	"path" text NOT NULL,
	"key_enc" text NOT NULL,
	"host_key" text,
	"post_command" text,
	"auto" boolean DEFAULT false NOT NULL,
	"last_at" timestamp with time zone,
	"last_ok" boolean,
	"last_message" text
);
--> statement-breakpoint
CREATE TABLE "secret_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"prefix" text NOT NULL,
	"env_ids" uuid[] NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"access" text DEFAULT 'ro' NOT NULL,
	"expires_at" timestamp with time zone,
	"ip_allow" text[],
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_ip" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "secret_tokens_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "secret_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"http_status" integer,
	"message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "secret_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"env_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret_enc" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secret_envs" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "secret_members" ADD COLUMN "env_ids" uuid[];--> statement-breakpoint
ALTER TABLE "secret_projects" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "secret_projects" SET "slug" = coalesce(nullif(trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''), 'project') || '-' || left("id"::text, 4);--> statement-breakpoint
ALTER TABLE "secret_projects" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "secret_tokens_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "secret_cli_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "secret_cli_tokens" ADD CONSTRAINT "secret_cli_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_device_codes" ADD CONSTRAINT "secret_device_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_push_targets" ADD CONSTRAINT "secret_push_targets_env_id_secret_envs_id_fk" FOREIGN KEY ("env_id") REFERENCES "public"."secret_envs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_tokens" ADD CONSTRAINT "secret_tokens_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_tokens" ADD CONSTRAINT "secret_tokens_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_webhook_deliveries" ADD CONSTRAINT "secret_webhook_deliveries_webhook_id_secret_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."secret_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_webhooks" ADD CONSTRAINT "secret_webhooks_env_id_secret_envs_id_fk" FOREIGN KEY ("env_id") REFERENCES "public"."secret_envs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "secret_cli_tokens_user_idx" ON "secret_cli_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "secret_tokens_project_idx" ON "secret_tokens" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "secret_webhook_deliveries_hook_idx" ON "secret_webhook_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "secret_webhooks_env_idx" ON "secret_webhooks" USING btree ("env_id");--> statement-breakpoint
ALTER TABLE "secret_projects" ADD CONSTRAINT "secret_projects_slug_unique" UNIQUE("slug");