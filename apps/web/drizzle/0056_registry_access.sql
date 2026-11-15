CREATE TABLE "registry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"repo_id" uuid,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_repo_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"repo_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_repo_collaborators" (
	"repo_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_repo_collaborators_repo_id_user_id_pk" PRIMARY KEY("repo_id","user_id"),
	CONSTRAINT "registry_repo_collaborators_role_check" CHECK ("registry_repo_collaborators"."role" in ('read', 'write', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "registry_team_members" (
	"team_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "registry_team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "registry_team_repos" (
	"team_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "registry_team_repos_team_id_repo_id_pk" PRIMARY KEY("team_id","repo_id"),
	CONSTRAINT "registry_team_repos_role_check" CHECK ("registry_team_repos"."role" in ('read', 'write', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "registry_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registry_tokens" DROP CONSTRAINT "registry_tokens_access_check";--> statement-breakpoint
ALTER TABLE "registry_repos" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registry_repos" ADD COLUMN "description" varchar(100);--> statement-breakpoint
ALTER TABLE "registry_repos" ADD COLUMN "description_custom" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registry_events" ADD CONSTRAINT "registry_events_namespace_id_registry_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."registry_namespaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_events" ADD CONSTRAINT "registry_events_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_events" ADD CONSTRAINT "registry_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_repo_aliases" ADD CONSTRAINT "registry_repo_aliases_namespace_id_registry_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."registry_namespaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_repo_aliases" ADD CONSTRAINT "registry_repo_aliases_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_repo_collaborators" ADD CONSTRAINT "registry_repo_collaborators_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_repo_collaborators" ADD CONSTRAINT "registry_repo_collaborators_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_team_members" ADD CONSTRAINT "registry_team_members_team_id_registry_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."registry_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_team_members" ADD CONSTRAINT "registry_team_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_team_repos" ADD CONSTRAINT "registry_team_repos_team_id_registry_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."registry_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_team_repos" ADD CONSTRAINT "registry_team_repos_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_teams" ADD CONSTRAINT "registry_teams_org_id_registry_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."registry_orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registry_events_ns_idx" ON "registry_events" USING btree ("namespace_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "registry_events_repo_idx" ON "registry_events" USING btree ("repo_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "registry_repo_aliases_ns_name_idx" ON "registry_repo_aliases" USING btree ("namespace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "registry_repo_aliases_repo_idx" ON "registry_repo_aliases" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "registry_repo_collaborators_user_idx" ON "registry_repo_collaborators" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "registry_team_members_user_idx" ON "registry_team_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "registry_team_repos_repo_idx" ON "registry_team_repos" USING btree ("repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registry_teams_org_name_idx" ON "registry_teams" USING btree ("org_id",lower("name"));--> statement-breakpoint
ALTER TABLE "registry_tokens" ADD CONSTRAINT "registry_tokens_access_check" CHECK ("registry_tokens"."access" in ('pull', 'push', 'delete'));--> statement-breakpoint
UPDATE "registry_tokens" SET "access" = 'delete' WHERE "access" = 'push';
