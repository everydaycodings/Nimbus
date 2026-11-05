-- Stars move to a per-person table; carry the owners' existing stars over.
INSERT INTO "stars" ("user_id", "node_id") SELECT "owner_id", "id" FROM "nodes" WHERE "starred";--> statement-breakpoint
ALTER TABLE "nodes" DROP COLUMN "starred";
