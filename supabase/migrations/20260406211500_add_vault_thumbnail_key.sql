-- Add thumbnail_key column to vault_files table
ALTER TABLE "public"."vault_files" ADD COLUMN "thumbnail_key" TEXT;

-- Index for thumbnail_key access
CREATE INDEX IF NOT EXISTS "idx_vault_files_thumbnail" ON "public"."vault_files" ("thumbnail_key");
