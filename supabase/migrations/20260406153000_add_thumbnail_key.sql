-- Add thumbnail_key column to files table
ALTER TABLE "public"."files" ADD COLUMN "thumbnail_key" TEXT;

-- Add thumbnail_key column to file_versions table
ALTER TABLE "public"."file_versions" ADD COLUMN "thumbnail_key" TEXT;

-- Index for thumbnail_key access if needed
CREATE INDEX IF NOT EXISTS "idx_files_thumbnail" ON "public"."files" ("thumbnail_key");
CREATE INDEX IF NOT EXISTS "idx_file_versions_thumbnail" ON "public"."file_versions" ("thumbnail_key");
