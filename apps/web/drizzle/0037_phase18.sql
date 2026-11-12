CREATE TABLE "phone_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"device_name" text NOT NULL,
	"folder_id" uuid,
	"contacts" boolean DEFAULT false NOT NULL,
	"calendar" boolean DEFAULT false NOT NULL,
	"last_contacts_at" timestamp with time zone,
	"last_calendar_at" timestamp with time zone,
	"stale_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"png" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signatures_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
ALTER TABLE "phone_backups" ADD CONSTRAINT "phone_backups_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_backups" ADD CONSTRAINT "phone_backups_folder_id_nodes_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "phone_backups_user_device_idx" ON "phone_backups" USING btree ("user_id","device_name");