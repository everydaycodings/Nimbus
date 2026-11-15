ALTER TABLE "registry_namespaces" ADD COLUMN "image_policy" jsonb;--> statement-breakpoint
ALTER TABLE "registry_scans" ADD COLUMN "packages" jsonb;--> statement-breakpoint
ALTER TABLE "registry_scans" ADD COLUMN "packages_truncated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registry_scans" ADD COLUMN "os" jsonb;--> statement-breakpoint
CREATE TABLE "registry_advice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registry_advice" ADD CONSTRAINT "registry_advice_repo_id_registry_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."registry_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registry_advice_repo_digest_idx" ON "registry_advice" USING btree ("repo_id","digest");
