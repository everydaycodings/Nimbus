CREATE TABLE "album_items" (
	"album_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "album_items_album_id_node_id_pk" PRIMARY KEY("album_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "album_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"grantee_id" text,
	"token" text,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_by" text NOT NULL,
	"name" text,
	"expires_at" timestamp with time zone,
	"password_hash" text,
	"pw_rev" integer DEFAULT 0 NOT NULL,
	"allow_download" boolean DEFAULT true NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "album_shares_token_unique" UNIQUE("token"),
	CONSTRAINT "album_shares_has_target" CHECK ("album_shares"."grantee_id" is not null or "album_shares"."token" is not null)
);
--> statement-breakpoint
CREATE TABLE "albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"cover_node_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_hides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"node_id" uuid,
	"day" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"owner_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"since" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_owner_id_partner_id_pk" PRIMARY KEY("owner_id","partner_id")
);
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "width" integer;--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "height" integer;--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "gps_checked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "smart" text[];--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "map_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "map_style_url" text DEFAULT 'https://tiles.openfreemap.org/styles/liberty' NOT NULL;--> statement-breakpoint
ALTER TABLE "album_items" ADD CONSTRAINT "album_items_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_items" ADD CONSTRAINT "album_items_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_items" ADD CONSTRAINT "album_items_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_shares" ADD CONSTRAINT "album_shares_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_shares" ADD CONSTRAINT "album_shares_grantee_id_user_id_fk" FOREIGN KEY ("grantee_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_shares" ADD CONSTRAINT "album_shares_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_cover_node_id_nodes_id_fk" FOREIGN KEY ("cover_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_hides" ADD CONSTRAINT "memory_hides_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_hides" ADD CONSTRAINT "memory_hides_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_partner_id_user_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "album_items_node_idx" ON "album_items" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "album_shares_album_idx" ON "album_shares" USING btree ("album_id");--> statement-breakpoint
CREATE INDEX "album_shares_grantee_idx" ON "album_shares" USING btree ("grantee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "album_shares_album_grantee_idx" ON "album_shares" USING btree ("album_id","grantee_id") WHERE "album_shares"."grantee_id" is not null;--> statement-breakpoint
CREATE INDEX "albums_owner_idx" ON "albums" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_hides_node_idx" ON "memory_hides" USING btree ("user_id","node_id") WHERE "memory_hides"."node_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_hides_day_idx" ON "memory_hides" USING btree ("user_id","day") WHERE "memory_hides"."day" is not null;--> statement-breakpoint
CREATE INDEX "partners_partner_idx" ON "partners" USING btree ("partner_id");