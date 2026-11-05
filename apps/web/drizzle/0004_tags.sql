CREATE TABLE "node_tags" (
	"node_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "node_tags_node_id_tag_id_pk" PRIMARY KEY("node_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_not_blank" CHECK (length(trim("tags"."name")) > 0),
	CONSTRAINT "tags_color_check" CHECK ("tags"."color" in ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'))
);
--> statement-breakpoint
ALTER TABLE "node_tags" ADD CONSTRAINT "node_tags_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_tags" ADD CONSTRAINT "node_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_tags_tag_id_idx" ON "node_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_owner_name_idx" ON "tags" USING btree ("owner_id",lower("name"));