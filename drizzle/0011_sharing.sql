CREATE TABLE "link_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ip" text,
	"ua" text,
	"detail" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"email" boolean NOT NULL,
	CONSTRAINT "notification_prefs_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"node_id" uuid,
	"actor_id" text,
	"count" integer DEFAULT 1 NOT NULL,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ownership_transfers" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shortcuts" (
	"user_id" text NOT NULL,
	"node_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shortcuts_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "stars" (
	"user_id" text NOT NULL,
	"node_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stars_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
ALTER TABLE "shares" DROP CONSTRAINT "shares_has_target";--> statement-breakpoint
DROP INDEX "nodes_owner_starred_idx";--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "via_share_id" uuid;--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "uploader_label" text;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "allow_reshare" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "public_links_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "max_link_days" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "require_link_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "grantee_email" text;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "pw_rev" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "allow_view" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "allow_download" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "allow_upload" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "upload_cap_bytes" bigint;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "download_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "last_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "link_events" ADD CONSTRAINT "link_events_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_from_id_user_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_to_id_user_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortcuts" ADD CONSTRAINT "shortcuts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortcuts" ADD CONSTRAINT "shortcuts_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_events_share_at_idx" ON "link_events" USING btree ("share_id","at");--> statement-breakpoint
CREATE INDEX "link_events_ip_kind_at_idx" ON "link_events" USING btree ("ip","kind","at");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "shortcuts_node_id_idx" ON "shortcuts" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "stars_node_id_idx" ON "stars" USING btree ("node_id");--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_via_share_id_shares_id_fk" FOREIGN KEY ("via_share_id") REFERENCES "public"."shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_versions_via_share_idx" ON "file_versions" USING btree ("via_share_id") WHERE "file_versions"."via_share_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shares_node_grantee_idx" ON "shares" USING btree ("node_id","grantee_id") WHERE "shares"."grantee_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "shares_node_email_idx" ON "shares" USING btree ("node_id",lower("grantee_email")) WHERE "shares"."grantee_email" is not null;--> statement-breakpoint
CREATE INDEX "shares_grantee_email_idx" ON "shares" USING btree (lower("grantee_email")) WHERE "shares"."grantee_email" is not null;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_has_target" CHECK ("shares"."grantee_id" is not null or "shares"."token" is not null or "shares"."grantee_email" is not null);