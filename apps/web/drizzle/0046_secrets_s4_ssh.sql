CREATE TABLE "secret_ssh_cas" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"private_enc" text NOT NULL,
	"next_serial" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "secret_ssh_certs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"serial" integer NOT NULL,
	"key_id" text NOT NULL,
	"principals" text NOT NULL,
	"public_fingerprint" text NOT NULL,
	"ca_fingerprint" text NOT NULL,
	"issued_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_ssh_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"username" text NOT NULL,
	"key_id" uuid,
	"use_ca" boolean DEFAULT false NOT NULL,
	"jump_host_id" uuid,
	"host_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_ssh_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"comment" text,
	"private_enc" text NOT NULL,
	"passphrase_enc" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secret_push_targets" ALTER COLUMN "key_enc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "secret_push_targets" ADD COLUMN "key_id" uuid;--> statement-breakpoint
ALTER TABLE "secret_ssh_cas" ADD CONSTRAINT "secret_ssh_cas_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_ssh_certs" ADD CONSTRAINT "secret_ssh_certs_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_ssh_certs" ADD CONSTRAINT "secret_ssh_certs_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_ssh_hosts" ADD CONSTRAINT "secret_ssh_hosts_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_ssh_hosts" ADD CONSTRAINT "secret_ssh_hosts_key_id_secret_ssh_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."secret_ssh_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_ssh_hosts" ADD CONSTRAINT "secret_ssh_hosts_jump_host_id_secret_ssh_hosts_id_fk" FOREIGN KEY ("jump_host_id") REFERENCES "public"."secret_ssh_hosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_ssh_keys" ADD CONSTRAINT "secret_ssh_keys_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_ssh_keys" ADD CONSTRAINT "secret_ssh_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "secret_ssh_certs_project_idx" ON "secret_ssh_certs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "secret_ssh_hosts_project_idx" ON "secret_ssh_hosts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "secret_ssh_keys_project_idx" ON "secret_ssh_keys" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "secret_push_targets" ADD CONSTRAINT "secret_push_targets_key_id_secret_ssh_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."secret_ssh_keys"("id") ON DELETE set null ON UPDATE no action;