CREATE TABLE "saved_logins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"ua" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "saved_logins" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "saved_logins_admins" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_logins" ADD CONSTRAINT "saved_logins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_logins_user_idx" ON "saved_logins" USING btree ("user_id");