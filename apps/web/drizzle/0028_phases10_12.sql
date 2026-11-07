CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"actor_id" text,
	"type" text NOT NULL,
	"detail" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "taken_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "activity_retention_days" integer DEFAULT 90;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_node_at_idx" ON "activity" USING btree ("node_id","at");--> statement-breakpoint
CREATE INDEX "activity_at_idx" ON "activity" USING btree ("at");