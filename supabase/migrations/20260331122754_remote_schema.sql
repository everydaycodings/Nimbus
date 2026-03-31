


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;




ALTER SCHEMA "public" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "wrappers" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."current_user_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select auth.uid();
$$;


ALTER FUNCTION "public"."current_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_trashed_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.is_trashed = true and old.is_trashed = false then
    new.trashed_at = now();
  elsif new.is_trashed = false then
    new.trashed_at = null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."set_trashed_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_storage_used"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if (TG_OP = 'INSERT') then
    update public.users
    set storage_used = storage_used + new.size
    where id = new.owner_id;

  elsif (TG_OP = 'DELETE') then
    update public.users
    set storage_used = greatest(0, storage_used - old.size)
    where id = old.owner_id;

  elsif (TG_OP = 'UPDATE') then
    -- handles re-upload / size change edge case
    update public.users
    set storage_used = greatest(0, storage_used - old.size + new.size)
    where id = new.owner_id;
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."update_storage_used"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."activity_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "resource_id" "uuid",
    "resource_type" "text",
    "action" "text" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "activity_log_action_check" CHECK (("action" = ANY (ARRAY['upload'::"text", 'download'::"text", 'delete'::"text", 'restore'::"text", 'rename'::"text", 'move'::"text", 'share'::"text", 'unshare'::"text", 'star'::"text", 'unstar'::"text"]))),
    CONSTRAINT "activity_log_resource_type_check" CHECK (("resource_type" = ANY (ARRAY['file'::"text", 'folder'::"text"])))
);


ALTER TABLE "public"."activity_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."file_tags" (
    "file_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL
);


ALTER TABLE "public"."file_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "size" bigint NOT NULL,
    "s3_key" "text" NOT NULL,
    "s3_bucket" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "parent_folder_id" "uuid",
    "is_starred" boolean DEFAULT false NOT NULL,
    "is_trashed" boolean DEFAULT false NOT NULL,
    "trashed_at" timestamp with time zone,
    "upload_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "files_upload_status_check" CHECK (("upload_status" = ANY (ARRAY['pending'::"text", 'uploading'::"text", 'complete'::"text", 'cancelled'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."folder_tags" (
    "folder_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL
);


ALTER TABLE "public"."folder_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "parent_folder_id" "uuid",
    "is_starred" boolean DEFAULT false NOT NULL,
    "is_trashed" boolean DEFAULT false NOT NULL,
    "trashed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "resource_id" "uuid" NOT NULL,
    "resource_type" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "permissions_resource_type_check" CHECK (("resource_type" = ANY (ARRAY['file'::"text", 'folder'::"text"]))),
    CONSTRAINT "permissions_role_check" CHECK (("role" = ANY (ARRAY['viewer'::"text", 'editor'::"text", 'owner'::"text"])))
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."share_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "resource_id" "uuid" NOT NULL,
    "resource_type" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(32), 'hex'::"text") NOT NULL,
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "password_hash" "text",
    CONSTRAINT "share_links_resource_type_check" CHECK (("resource_type" = ANY (ARRAY['file'::"text", 'folder'::"text"]))),
    CONSTRAINT "share_links_role_check" CHECK (("role" = ANY (ARRAY['viewer'::"text", 'editor'::"text"])))
);


ALTER TABLE "public"."share_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "storage_used" bigint DEFAULT 0 NOT NULL,
    "storage_limit" bigint DEFAULT 1073741824 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vault_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vault_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "original_mime_type" "text" DEFAULT 'application/octet-stream'::"text" NOT NULL,
    "size" bigint DEFAULT 0 NOT NULL,
    "s3_key" "text" NOT NULL,
    "s3_bucket" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parent_folder_id" "uuid"
);


ALTER TABLE "public"."vault_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vault_folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vault_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "parent_folder_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vault_folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vaults" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "salt" "text" NOT NULL,
    "verification_token" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vaults" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."file_tags"
    ADD CONSTRAINT "file_tags_pkey" PRIMARY KEY ("file_id", "tag_id");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_s3_key_key" UNIQUE ("s3_key");



ALTER TABLE ONLY "public"."folder_tags"
    ADD CONSTRAINT "folder_tags_pkey" PRIMARY KEY ("folder_id", "tag_id");



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_resource_id_resource_type_user_id_key" UNIQUE ("resource_id", "resource_type", "user_id");



ALTER TABLE ONLY "public"."share_links"
    ADD CONSTRAINT "share_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."share_links"
    ADD CONSTRAINT "share_links_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_name_owner_id_key" UNIQUE ("name", "owner_id");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vault_files"
    ADD CONSTRAINT "vault_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vault_files"
    ADD CONSTRAINT "vault_files_s3_key_key" UNIQUE ("s3_key");



ALTER TABLE ONLY "public"."vault_folders"
    ADD CONSTRAINT "vault_folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vaults"
    ADD CONSTRAINT "vaults_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_activity_resource" ON "public"."activity_log" USING "btree" ("resource_id");



CREATE INDEX "idx_activity_user" ON "public"."activity_log" USING "btree" ("user_id");



CREATE INDEX "idx_file_tags_file" ON "public"."file_tags" USING "btree" ("file_id");



CREATE INDEX "idx_file_tags_tag" ON "public"."file_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_files_folder" ON "public"."files" USING "btree" ("parent_folder_id");



CREATE INDEX "idx_files_name_search" ON "public"."files" USING "gin" ("to_tsvector"('"english"'::"regconfig", "name"));



CREATE INDEX "idx_files_owner" ON "public"."files" USING "btree" ("owner_id");



CREATE INDEX "idx_files_starred" ON "public"."files" USING "btree" ("owner_id") WHERE ("is_starred" = true);



CREATE INDEX "idx_files_status" ON "public"."files" USING "btree" ("upload_status");



CREATE INDEX "idx_files_trashed" ON "public"."files" USING "btree" ("owner_id") WHERE ("is_trashed" = true);



CREATE INDEX "idx_folder_tags_folder" ON "public"."folder_tags" USING "btree" ("folder_id");



CREATE INDEX "idx_folder_tags_tag" ON "public"."folder_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_folders_name_search" ON "public"."folders" USING "gin" ("to_tsvector"('"english"'::"regconfig", "name"));



CREATE INDEX "idx_folders_owner" ON "public"."folders" USING "btree" ("owner_id");



CREATE INDEX "idx_folders_parent" ON "public"."folders" USING "btree" ("parent_folder_id");



CREATE INDEX "idx_folders_starred" ON "public"."folders" USING "btree" ("owner_id") WHERE ("is_starred" = true);



CREATE INDEX "idx_folders_trashed" ON "public"."folders" USING "btree" ("owner_id") WHERE ("is_trashed" = true);



CREATE INDEX "idx_permissions_resource" ON "public"."permissions" USING "btree" ("resource_id", "resource_type");



CREATE INDEX "idx_permissions_user" ON "public"."permissions" USING "btree" ("user_id");



CREATE INDEX "idx_share_links_token" ON "public"."share_links" USING "btree" ("token");



CREATE INDEX "idx_tags_owner" ON "public"."tags" USING "btree" ("owner_id");



CREATE INDEX "idx_vault_files_folder" ON "public"."vault_files" USING "btree" ("parent_folder_id");



CREATE INDEX "idx_vault_files_vault" ON "public"."vault_files" USING "btree" ("vault_id");



CREATE INDEX "idx_vault_folders_parent" ON "public"."vault_folders" USING "btree" ("parent_folder_id");



CREATE INDEX "idx_vault_folders_vault" ON "public"."vault_folders" USING "btree" ("vault_id");



CREATE INDEX "idx_vaults_owner" ON "public"."vaults" USING "btree" ("owner_id");



CREATE OR REPLACE TRIGGER "trg_files_trashed_at" BEFORE UPDATE OF "is_trashed" ON "public"."files" FOR EACH ROW EXECUTE FUNCTION "public"."set_trashed_at"();



CREATE OR REPLACE TRIGGER "trg_files_updated_at" BEFORE UPDATE ON "public"."files" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_folders_trashed_at" BEFORE UPDATE OF "is_trashed" ON "public"."folders" FOR EACH ROW EXECUTE FUNCTION "public"."set_trashed_at"();



CREATE OR REPLACE TRIGGER "trg_folders_updated_at" BEFORE UPDATE ON "public"."folders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_storage_used" AFTER INSERT OR DELETE OR UPDATE OF "size" ON "public"."files" FOR EACH ROW EXECUTE FUNCTION "public"."update_storage_used"();



CREATE OR REPLACE TRIGGER "trg_tags_updated_at" BEFORE UPDATE ON "public"."tags" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_vault_files_updated_at" BEFORE UPDATE ON "public"."vault_files" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_vault_folders_updated_at" BEFORE UPDATE ON "public"."vault_folders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_vaults_updated_at" BEFORE UPDATE ON "public"."vaults" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."activity_log"
    ADD CONSTRAINT "activity_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."file_tags"
    ADD CONSTRAINT "file_tags_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."file_tags"
    ADD CONSTRAINT "file_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."folder_tags"
    ADD CONSTRAINT "folder_tags_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."folder_tags"
    ADD CONSTRAINT "folder_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."share_links"
    ADD CONSTRAINT "share_links_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vault_files"
    ADD CONSTRAINT "vault_files_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."vault_folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vault_files"
    ADD CONSTRAINT "vault_files_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vault_folders"
    ADD CONSTRAINT "vault_folders_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."vault_folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vault_folders"
    ADD CONSTRAINT "vault_folders_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vaults"
    ADD CONSTRAINT "vaults_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."activity_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_log_select_own" ON "public"."activity_log" FOR SELECT USING (("user_id" = "public"."current_user_id"()));



ALTER TABLE "public"."file_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "file_tags_owner_all" ON "public"."file_tags" USING ((EXISTS ( SELECT 1
   FROM "public"."files"
  WHERE (("files"."id" = "file_tags"."file_id") AND ("files"."owner_id" = "public"."current_user_id"())))));



ALTER TABLE "public"."files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "files_owner_all" ON "public"."files" USING (("owner_id" = "public"."current_user_id"()));



CREATE POLICY "files_shared_select" ON "public"."files" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."permissions"
  WHERE (("permissions"."resource_id" = "files"."id") AND ("permissions"."resource_type" = 'file'::"text") AND ("permissions"."user_id" = "public"."current_user_id"())))));



ALTER TABLE "public"."folder_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "folder_tags_owner_all" ON "public"."folder_tags" USING ((EXISTS ( SELECT 1
   FROM "public"."folders"
  WHERE (("folders"."id" = "folder_tags"."folder_id") AND ("folders"."owner_id" = "public"."current_user_id"())))));



ALTER TABLE "public"."folders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "folders_owner_all" ON "public"."folders" USING (("owner_id" = "public"."current_user_id"()));



CREATE POLICY "folders_shared_select" ON "public"."folders" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."permissions"
  WHERE (("permissions"."resource_id" = "folders"."id") AND ("permissions"."resource_type" = 'folder'::"text") AND ("permissions"."user_id" = "public"."current_user_id"())))));



ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permissions_owner_manage" ON "public"."permissions" USING ((EXISTS ( SELECT 1
   FROM "public"."files"
  WHERE (("files"."id" = "permissions"."resource_id") AND ("files"."owner_id" = "public"."current_user_id"()))
UNION
 SELECT 1
   FROM "public"."folders"
  WHERE (("folders"."id" = "permissions"."resource_id") AND ("folders"."owner_id" = "public"."current_user_id"())))));



ALTER TABLE "public"."share_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "share_links_owner_all" ON "public"."share_links" USING (("owner_id" = "public"."current_user_id"()));



ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tags_owner_all" ON "public"."tags" USING (("owner_id" = "public"."current_user_id"()));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_select_own" ON "public"."users" FOR SELECT USING (("id" = "public"."current_user_id"()));



CREATE POLICY "users_update_own" ON "public"."users" FOR UPDATE USING (("id" = "public"."current_user_id"()));



ALTER TABLE "public"."vault_files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vault_files_owner_all" ON "public"."vault_files" USING ((EXISTS ( SELECT 1
   FROM "public"."vaults"
  WHERE (("vaults"."id" = "vault_files"."vault_id") AND ("vaults"."owner_id" = "public"."current_user_id"())))));



ALTER TABLE "public"."vault_folders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vault_folders_owner_all" ON "public"."vault_folders" USING ((EXISTS ( SELECT 1
   FROM "public"."vaults"
  WHERE (("vaults"."id" = "vault_folders"."vault_id") AND ("vaults"."owner_id" = "public"."current_user_id"())))));



ALTER TABLE "public"."vaults" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vaults_owner_all" ON "public"."vaults" USING (("owner_id" = "public"."current_user_id"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
























































































































































































































































































































GRANT ALL ON FUNCTION "public"."current_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_trashed_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_trashed_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_trashed_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_storage_used"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_storage_used"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_storage_used"() TO "service_role";





















GRANT ALL ON TABLE "public"."activity_log" TO "anon";
GRANT ALL ON TABLE "public"."activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_log" TO "service_role";



GRANT ALL ON TABLE "public"."file_tags" TO "anon";
GRANT ALL ON TABLE "public"."file_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."file_tags" TO "service_role";



GRANT ALL ON TABLE "public"."files" TO "anon";
GRANT ALL ON TABLE "public"."files" TO "authenticated";
GRANT ALL ON TABLE "public"."files" TO "service_role";



GRANT ALL ON TABLE "public"."folder_tags" TO "anon";
GRANT ALL ON TABLE "public"."folder_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."folder_tags" TO "service_role";



GRANT ALL ON TABLE "public"."folders" TO "anon";
GRANT ALL ON TABLE "public"."folders" TO "authenticated";
GRANT ALL ON TABLE "public"."folders" TO "service_role";



GRANT ALL ON TABLE "public"."permissions" TO "anon";
GRANT ALL ON TABLE "public"."permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."permissions" TO "service_role";



GRANT ALL ON TABLE "public"."share_links" TO "anon";
GRANT ALL ON TABLE "public"."share_links" TO "authenticated";
GRANT ALL ON TABLE "public"."share_links" TO "service_role";



GRANT ALL ON TABLE "public"."tags" TO "anon";
GRANT ALL ON TABLE "public"."tags" TO "authenticated";
GRANT ALL ON TABLE "public"."tags" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."vault_files" TO "anon";
GRANT ALL ON TABLE "public"."vault_files" TO "authenticated";
GRANT ALL ON TABLE "public"."vault_files" TO "service_role";



GRANT ALL ON TABLE "public"."vault_folders" TO "anon";
GRANT ALL ON TABLE "public"."vault_folders" TO "authenticated";
GRANT ALL ON TABLE "public"."vault_folders" TO "service_role";



GRANT ALL ON TABLE "public"."vaults" TO "anon";
GRANT ALL ON TABLE "public"."vaults" TO "authenticated";
GRANT ALL ON TABLE "public"."vaults" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";




























drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


