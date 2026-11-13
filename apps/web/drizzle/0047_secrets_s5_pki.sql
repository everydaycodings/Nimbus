CREATE TABLE "secret_acme_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"directory" text NOT NULL,
	"email" text NOT NULL,
	"key_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_acme_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"domains" jsonb NOT NULL,
	"challenge" text NOT NULL,
	"cred_id" uuid,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"order_enc" text,
	"key_enc" text,
	"challenges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"renew_cert_id" uuid,
	"cert_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_cas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"cert_pem" text NOT NULL,
	"key_enc" text NOT NULL,
	"subject" text NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_cert_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ca_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"san_patterns" jsonb NOT NULL,
	"max_ttl_days" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_certs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"cert_pem" text NOT NULL,
	"chain_pem" text DEFAULT '' NOT NULL,
	"key_enc" text,
	"subject" text NOT NULL,
	"issuer" text NOT NULL,
	"serial" text NOT NULL,
	"sans" jsonb NOT NULL,
	"key_type" text NOT NULL,
	"fingerprint" text NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"ca_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" integer,
	"acme" jsonb,
	"warned_days" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_dns_creds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"cred_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"data_enc" text NOT NULL,
	"expires_at" timestamp with time zone,
	"warned_days" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secret_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 443 NOT NULL,
	"subject" text,
	"issuer" text,
	"not_after" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"error" text,
	"warned_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secret_acme_accounts" ADD CONSTRAINT "secret_acme_accounts_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_acme_orders" ADD CONSTRAINT "secret_acme_orders_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_acme_orders" ADD CONSTRAINT "secret_acme_orders_account_id_secret_acme_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."secret_acme_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_acme_orders" ADD CONSTRAINT "secret_acme_orders_cred_id_secret_dns_creds_id_fk" FOREIGN KEY ("cred_id") REFERENCES "public"."secret_dns_creds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_acme_orders" ADD CONSTRAINT "secret_acme_orders_renew_cert_id_secret_certs_id_fk" FOREIGN KEY ("renew_cert_id") REFERENCES "public"."secret_certs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_acme_orders" ADD CONSTRAINT "secret_acme_orders_cert_id_secret_certs_id_fk" FOREIGN KEY ("cert_id") REFERENCES "public"."secret_certs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_acme_orders" ADD CONSTRAINT "secret_acme_orders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_cas" ADD CONSTRAINT "secret_cas_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_cas" ADD CONSTRAINT "secret_cas_parent_id_secret_cas_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."secret_cas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_cas" ADD CONSTRAINT "secret_cas_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_cert_templates" ADD CONSTRAINT "secret_cert_templates_ca_id_secret_cas_id_fk" FOREIGN KEY ("ca_id") REFERENCES "public"."secret_cas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_certs" ADD CONSTRAINT "secret_certs_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_certs" ADD CONSTRAINT "secret_certs_ca_id_secret_cas_id_fk" FOREIGN KEY ("ca_id") REFERENCES "public"."secret_cas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_certs" ADD CONSTRAINT "secret_certs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_dns_creds" ADD CONSTRAINT "secret_dns_creds_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_items" ADD CONSTRAINT "secret_items_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_items" ADD CONSTRAINT "secret_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secret_watches" ADD CONSTRAINT "secret_watches_project_id_secret_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."secret_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "secret_acme_accounts_dir_idx" ON "secret_acme_accounts" USING btree ("project_id","directory");--> statement-breakpoint
CREATE INDEX "secret_acme_orders_project_idx" ON "secret_acme_orders" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "secret_cas_project_idx" ON "secret_cas" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "secret_cert_templates_ca_idx" ON "secret_cert_templates" USING btree ("ca_id");--> statement-breakpoint
CREATE INDEX "secret_certs_project_idx" ON "secret_certs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "secret_certs_ca_idx" ON "secret_certs" USING btree ("ca_id");--> statement-breakpoint
CREATE INDEX "secret_dns_creds_project_idx" ON "secret_dns_creds" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "secret_items_project_idx" ON "secret_items" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "secret_watches_target_idx" ON "secret_watches" USING btree ("project_id","host","port");