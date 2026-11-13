CREATE TABLE "secret_kms_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'enabled' NOT NULL,
	"latest" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_kms_versions" (
	"key_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"material_enc" text NOT NULL,
	"public_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secret_kms_versions_key_id_version_pk" PRIMARY KEY("key_id","version")
);
--> statement-breakpoint
CREATE TABLE "secret_leak_allow" (
	"user_id" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "secret_leak_allow_user_id_hash_pk" PRIMARY KEY("user_id","hash")
);
--> statement-breakpoint
CREATE TABLE "secret_leaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"node_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"line" integer NOT NULL,
	"masked" text NOT NULL,
	"hash" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_root_key" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"fingerprint" text NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"running" boolean DEFAULT false NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "secret_tokens" ADD COLUMN "scopes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "secret_leak_scan" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "secret_hibp" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "secret_kms_keys" ADD CONSTRAINT "secret_kms_keys_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_kms_keys" ADD CONSTRAINT "secret_kms_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_kms_versions" ADD CONSTRAINT "secret_kms_versions_key_id_secret_kms_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."secret_kms_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_leak_allow" ADD CONSTRAINT "secret_leak_allow_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_leaks" ADD CONSTRAINT "secret_leaks_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_leaks" ADD CONSTRAINT "secret_leaks_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "secret_kms_keys_name_idx" ON "secret_kms_keys" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "secret_leaks_node_hash_idx" ON "secret_leaks" USING btree ("node_id","hash");--> statement-breakpoint
CREATE INDEX "secret_leaks_owner_idx" ON "secret_leaks" USING btree ("owner_id","status");
