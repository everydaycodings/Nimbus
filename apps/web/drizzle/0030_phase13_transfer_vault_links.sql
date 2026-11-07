CREATE TABLE "transfer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ip" text,
	"ua" text,
	"detail" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"size" bigint NOT NULL,
	"mime" text,
	"s3_key" text NOT NULL,
	"thumb" boolean DEFAULT false NOT NULL,
	"upload_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_files_upload_id_unique" UNIQUE("upload_id")
);
--> statement-breakpoint
CREATE TABLE "transfer_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"email" text,
	"token" text NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"last_at" timestamp with time zone,
	CONSTRAINT "transfer_recipients_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" text NOT NULL,
	"title" text,
	"message" text,
	"expires_at" timestamp with time zone NOT NULL,
	"password_hash" text,
	"download_limit" integer,
	"downloads" integer DEFAULT 0 NOT NULL,
	"draft" boolean DEFAULT true NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_link_versions" (
	"link_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	CONSTRAINT "vault_link_versions_link_id_version_id_pk" PRIMARY KEY("link_id","version_id")
);
--> statement-breakpoint
CREATE TABLE "vault_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"owner_id" text NOT NULL,
	"vault_id" uuid NOT NULL,
	"manifest" text NOT NULL,
	"kdf_salt" text,
	"kdf_iterations" integer,
	"kdf_memory" integer,
	"wrapped_link_key" text,
	"label" text NOT NULL,
	"expires_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "transfers_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "vault_links_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "transfer_max_days" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "transfer_max_bytes" bigint;--> statement-breakpoint
ALTER TABLE "transfer_events" ADD CONSTRAINT "transfer_events_recipient_id_transfer_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."transfer_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_files" ADD CONSTRAINT "transfer_files_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_recipients" ADD CONSTRAINT "transfer_recipients_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_link_versions" ADD CONSTRAINT "vault_link_versions_link_id_vault_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."vault_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_link_versions" ADD CONSTRAINT "vault_link_versions_version_id_file_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_links" ADD CONSTRAINT "vault_links_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_links" ADD CONSTRAINT "vault_links_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_events_recipient_at_idx" ON "transfer_events" USING btree ("recipient_id","at");--> statement-breakpoint
CREATE INDEX "transfer_events_ip_kind_at_idx" ON "transfer_events" USING btree ("ip","kind","at");--> statement-breakpoint
CREATE INDEX "transfer_files_transfer_idx" ON "transfer_files" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "transfer_recipients_transfer_idx" ON "transfer_recipients" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "transfers_sender_idx" ON "transfers" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "transfers_expires_idx" ON "transfers" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "vault_links_owner_idx" ON "vault_links" USING btree ("owner_id");