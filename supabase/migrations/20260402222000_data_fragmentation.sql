-- 20260402222000_data_fragmentation.sql
-- Implements Data Fragmentation (Sharding) schema changes

-- 1. Update vaults table to store fragmentation preference
ALTER TABLE "public"."vaults" ADD COLUMN "is_fragmented" boolean DEFAULT false NOT NULL;

-- 2. Update vault_files table to track fragmentation status and chunk count
ALTER TABLE "public"."vault_files" ADD COLUMN "is_fragmented" boolean DEFAULT false NOT NULL;
ALTER TABLE "public"."vault_files" ADD COLUMN "chunk_count" integer DEFAULT 1 NOT NULL;

-- 3. Create vault_file_chunks table to store individual fragments
CREATE TABLE IF NOT EXISTS "public"."vault_file_chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "file_id" "uuid" NOT NULL,
    "chunk_index" integer NOT NULL,
    "s3_key" "text" NOT NULL,
    "s3_bucket" "text" NOT NULL,
    "size" bigint NOT NULL,
    "hash" "text", -- SHA-256 hash for integrity
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vault_file_chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vault_file_chunks_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."vault_files"("id") ON DELETE CASCADE
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE "public"."vault_file_chunks" ENABLE ROW LEVEL SECURITY;

-- 5. Add RLS Policy for vault_file_chunks
-- Users can only access chunks of files they own via their vaults
CREATE POLICY "vault_file_chunks_owner_all" ON "public"."vault_file_chunks" FOR ALL USING (
    EXISTS (
        SELECT 1 FROM public.vault_files vf
        JOIN public.vaults v ON v.id = vf.vault_id
        WHERE vf.id = public.vault_file_chunks.file_id
        AND v.owner_id = public.current_user_id()
    )
);

-- 6. Add performance index
CREATE INDEX "idx_vault_file_chunks_file" ON "public"."vault_file_chunks" USING "btree" ("file_id");
