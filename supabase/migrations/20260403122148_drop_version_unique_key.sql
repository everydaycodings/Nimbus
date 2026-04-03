-- supabase/migrations/20260403122148_drop_version_unique_key.sql
ALTER TABLE "public"."file_versions" DROP CONSTRAINT IF EXISTS "file_versions_s3_key_key";
