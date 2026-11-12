CREATE TABLE "playback_positions" (
	"user_id" text NOT NULL,
	"node_id" uuid NOT NULL,
	"position_sec" double precision NOT NULL,
	"duration_sec" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playback_positions_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "video_renditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"height" integer NOT NULL,
	"key" text,
	"size" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"codec" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "video_copies" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "video_copy_cap_bytes" bigint;--> statement-breakpoint
ALTER TABLE "playback_positions" ADD CONSTRAINT "playback_positions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_positions" ADD CONSTRAINT "playback_positions_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_renditions" ADD CONSTRAINT "video_renditions_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_renditions_source_idx" ON "video_renditions" USING btree ("source_key","height");--> statement-breakpoint
CREATE INDEX "video_renditions_node_idx" ON "video_renditions" USING btree ("node_id");