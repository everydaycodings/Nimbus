CREATE TABLE "registry_git_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"username" text,
	"account" text,
	"host" text,
	"secret_enc" text NOT NULL,
	"expires_at" timestamp with time zone,
	"warned_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "registry_git_connections_provider_check" CHECK ("registry_git_connections"."provider" in ('github', 'gitlab', 'gitea', 'git', 'ssh'))
);
--> statement-breakpoint
ALTER TABLE "registry_build_sources" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "registry_build_sources" ADD COLUMN "connection_lost" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registry_git_connections" ADD CONSTRAINT "registry_git_connections_namespace_id_registry_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."registry_namespaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registry_git_connections_name_idx" ON "registry_git_connections" USING btree ("namespace_id",lower("name"));--> statement-breakpoint
ALTER TABLE "registry_build_sources" ADD CONSTRAINT "registry_build_sources_connection_id_registry_git_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."registry_git_connections"("id") ON DELETE set null ON UPDATE no action;