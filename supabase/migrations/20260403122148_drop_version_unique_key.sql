-- supabase/migrations/20260403122148_drop_version_unique_key.sql
DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'file_versions') THEN
        ALTER TABLE "public"."file_versions" DROP CONSTRAINT IF EXISTS "file_versions_s3_key_key";
    END IF;
END $$;

