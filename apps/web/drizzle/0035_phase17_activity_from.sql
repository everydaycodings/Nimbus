ALTER TABLE "activity" ADD COLUMN "from_name" text;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "from_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "link_events" DROP COLUMN "from_name";--> statement-breakpoint
ALTER TABLE "link_events" DROP COLUMN "from_parent_id";