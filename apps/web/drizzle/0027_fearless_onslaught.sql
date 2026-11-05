CREATE TABLE "device_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"poll_hash" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"device_name" text,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "device_links_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "device_links_poll_hash_unique" UNIQUE("poll_hash")
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "device_links" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "device_links" ADD CONSTRAINT "device_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_links_user_idx" ON "device_links" USING btree ("user_id");