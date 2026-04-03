-- supabase/migrations/20260403195500_file_versions_trash.sql

-- 1. Add is_trashed and trashed_at to file_versions
ALTER TABLE "public"."file_versions" ADD COLUMN "is_trashed" boolean DEFAULT false NOT NULL;
ALTER TABLE "public"."file_versions" ADD COLUMN "trashed_at" timestamp with time zone;

-- 2. Add index for trashed versions
CREATE INDEX "idx_file_versions_trashed" ON "public"."file_versions" USING "btree" ("file_id") WHERE ("is_trashed" = true);

-- 3. Add trigger for set_trashed_at
CREATE OR REPLACE TRIGGER "trg_file_versions_trashed_at" 
    BEFORE UPDATE OF "is_trashed" ON "public"."file_versions" 
    FOR EACH ROW EXECUTE FUNCTION "public"."set_trashed_at"();
