-- supabase/migrations/20260403173000_file_versioning.sql

-- 1. Create file_versions table
CREATE TABLE IF NOT EXISTS "public"."file_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "file_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "size" bigint NOT NULL,
    "s3_key" "text" NOT NULL,
    "s3_bucket" "text" NOT NULL,
    "version_number" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "file_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE CASCADE
);

-- 2. Enable RLS
ALTER TABLE "public"."file_versions" ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policy
DROP POLICY IF EXISTS "file_versions_owner_all" ON "public"."file_versions";
CREATE POLICY "file_versions_owner_all" ON "public"."file_versions"
    USING (EXISTS (
        SELECT 1 FROM "public"."files"
        WHERE "files"."id" = "file_versions"."file_id"
        AND "files"."owner_id" = "public"."current_user_id"()
    ));

-- 4. Update activity_log action check constraint
-- In PostgreSQL, you can't directly append to an existing check constraint easily.
-- We'll drop and recreate the constraint.
ALTER TABLE "public"."activity_log" DROP CONSTRAINT "activity_log_action_check";
ALTER TABLE "public"."activity_log" ADD CONSTRAINT "activity_log_action_check" 
    CHECK (("action" = ANY (ARRAY['upload'::"text", 'download'::"text", 'delete'::"text", 'restore'::"text", 'rename'::"text", 'move'::"text", 'share'::"text", 'unshare'::"text", 'star'::"text", 'unstar'::"text", 'profile_update'::"text", 'security_update'::"text", 'mfa_enroll'::"text", 'mfa_unenroll'::"text", 'tag'::"text", 'untag'::"text", 'version_restore'::"text", 'version_delete'::"text"])));

-- 5. Add index for performance
DROP INDEX IF EXISTS "idx_file_versions_file";
CREATE INDEX "idx_file_versions_file" ON "public"."file_versions" USING "btree" ("file_id");

-- 6. Add trigger for storage accounting on file_versions
CREATE OR REPLACE FUNCTION "public"."update_storage_used_versions"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if (TG_OP = 'INSERT') then
    update public.users
    set storage_used = storage_used + new.size
    where id = (select owner_id from public.files where id = new.file_id);

  elsif (TG_OP = 'DELETE') then
    update public.users
    set storage_used = greatest(0, storage_used - old.size)
    where id = (select owner_id from public.files where id = old.file_id);
  end if;

  return null;
end;
$$;

DROP TRIGGER IF EXISTS "trg_file_versions_storage" ON "public"."file_versions";
CREATE TRIGGER "trg_file_versions_storage" AFTER INSERT OR DELETE ON "public"."file_versions"
    FOR EACH ROW EXECUTE FUNCTION "public"."update_storage_used_versions"();
