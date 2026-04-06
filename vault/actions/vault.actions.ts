// vault/actions/vault.actions.ts
"use server";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { Vault } from "@/vault/types/vault";
import { STEALTH_NAME_PREFIX } from "@/vault/lib/crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function getUser(userId: string) {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();
  return data;
}

// ── Create vault ──────────────────────────────────────────────
// salt and verificationToken are computed client-side and passed here.
// The server stores them but NEVER sees the password.
export async function createVault(input: {
  id?:               string;
  name:              string;
  saltBase64:        string;    // random salt for PBKDF2
  verificationToken: string;    // AES-GCM encrypted token to verify password
  isFragmented?:      boolean;
}) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { data, error } = await supabase
    .from("vaults")
    .insert({
      id:                 input.id,
      name:               input.name,
      owner_id:           user.id,
      salt:               input.saltBase64,
      verification_token: input.verificationToken,
      is_fragmented:      input.isFragmented ?? false,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ── List vaults ───────────────────────────────────────────────
export async function getVaults(): Promise<Vault[]> {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("vaults")
    .select("id, name, salt, verification_token, is_fragmented, created_at, updated_at")
    .eq("owner_id", userId)
    .not("name", "ilike", `${STEALTH_NAME_PREFIX}%`)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── Get vault by ID ───────────────────────────────────────────
export async function getVaultById(vaultId: string): Promise<Vault | null> {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  // Use service role to bypass RLS for discovery, but manually verify ownership
  const { data, error } = await supabase
    .from("vaults")
    .select("id, name, salt, verification_token, is_fragmented, created_at, updated_at, owner_id")
    .eq("id", vaultId)
    .single();

  if (error || !data) return null;
  if (data.owner_id !== userId) return null;

  const { owner_id, ...vault } = data;
  return vault as Vault;
}

// ── Delete vault (and all its files) ─────────────────────────
export async function deleteVault(vaultId: string) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { error } = await supabase
    .from("vaults")
    .delete()
    .eq("id", vaultId)
    .eq("owner_id", user.id);

  if (error) throw new Error(error.message);
}

// ── List vault files ──────────────────────────────────────────
// ── List vault files ──────────────────────────────────────────
export async function getVaultFiles(vaultId: string) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  // Single-hit verification and fetch: fetch vault items only if the user owns the vault
  const { data, error } = await supabase
    .from("vault_files")
    .select(`
      id, name, original_mime_type, size, s3_key, thumbnail_key, created_at, updated_at,
      vaults!inner(owner_id)
    `)
    .eq("vault_id", vaultId)
    .eq("vaults.owner_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map(({ vaults, ...rest }) => rest);
}

// ── Save vault file metadata after upload ─────────────────────
export async function saveVaultFile(input: {
  id?:              string;
  vaultId:          string;
  name:             string;
  originalMimeType: string;
  size:             number;       // original file size
  s3Key:            string;
  s3Bucket:         string;
  thumbnailKey?:    string | null;
  parentFolderId?: string | null;
  isFragmented?:    boolean;
  chunkCount?:      number;
  chunks?:          Array<{ s3Key: string, size: number, chunkIndex: number, hash?: string }>;
}) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  // Verify vault ownership
  const { data: vault } = await supabase
    .from("vaults")
    .select("id")
    .eq("id", input.vaultId)
    .eq("owner_id", user.id)
    .single();

  if (!vault) throw new Error("Vault not found");

  if (input.parentFolderId) {
    const { data: folder } = await supabase
      .from("vault_folders")
      .select("id")
      .eq("id", input.parentFolderId)
      .eq("vault_id", input.vaultId)
      .single();

    if (!folder) throw new Error("Folder not found");
  }

  const { data, error } = await supabase
    .from("vault_files")
    .upsert({
      id:                 input.id, // optional: if provided, updates existing; if not, inserts new
      vault_id:           input.vaultId,
      name:               input.name,
      original_mime_type: input.originalMimeType,
      size:               input.size,
      s3_key:             input.s3Key,
      s3_bucket:          input.s3Bucket,
      thumbnail_key:      input.thumbnailKey,
      parent_folder_id:   input.parentFolderId ?? null,
      is_fragmented:      input.isFragmented ?? false,
      chunk_count:        input.chunkCount ?? 1,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  if (input.isFragmented && input.chunks && input.chunks.length > 0) {
    const { error: chunkError } = await supabase
      .from("vault_file_chunks")
      .insert(
        input.chunks.map(c => ({
          file_id: data.id,
          chunk_index: c.chunkIndex,
          s3_key: c.s3Key,
          s3_bucket: input.s3Bucket,
          size: c.size,
          hash: c.hash
        }))
      );
    if (chunkError) throw new Error(chunkError.message);
  }

  return data;
}

// ── Delete vault file ─────────────────────────────────────────
export async function deleteVaultFile(fileId: string) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  // Get file + verify ownership via vault
  const { data: file } = await supabase
    .from("vault_files")
    .select("id, s3_key, vaults(owner_id)")
    .eq("id", fileId)
    .single();

  if (!file) throw new Error("File not found");

  const vaultOwner = (file.vaults as any)?.owner_id;
  if (vaultOwner !== user.id) throw new Error("Access denied");

  const { error } = await supabase
    .from("vault_files")
    .delete()
    .eq("id", fileId);

  if (error) throw new Error(error.message);

  return { s3Key: file.s3_key };
}

// ── Get presigned upload URL for vault file ───────────────────
// Separate from regular upload — vault files go to a separate S3 prefix
export async function getVaultPresignedUrl(input: {
  vaultId:  string;
  fileName: string;
  mimeType: string;
  size:     number;  // encrypted size (larger than original)
  chunkCount?: number;
  includeThumbnail?: boolean;
}) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { data: vault } = await supabase
    .from("vaults")
    .select("id")
    .eq("id", input.vaultId)
    .eq("owner_id", user.id)
    .single();

  if (!vault) throw new Error("Vault not found");

  // Server-side size limit for fragmented files
  const FRAGMENTED_MAX = 50 * 1024 * 1024;
  if (input.chunkCount && input.chunkCount > 1 && input.size > FRAGMENTED_MAX) {
    throw new Error("Fragmented files are limited to 50MB");
  }

  // Import S3 utilities
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl }     = await import("@aws-sdk/s3-request-presigner");
  const { s3, BUCKET }       = await import("@/lib/s3");
  const { randomUUID }       = await import("crypto");

  const fileId = randomUUID();
  const s3Key  = `vault/${user.id}/${input.vaultId}/${fileId}.enc`;

  const command = new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         s3Key,
    ContentType: "application/octet-stream", // always — content is encrypted
  });

  const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  let thumbnailInfo;
  if (input.includeThumbnail) {
    const thumbS3Key = `vault/${user.id}/${input.vaultId}/${fileId}.thumb.enc`;
    const thumbCommand = new PutObjectCommand({
      Bucket: BUCKET,
      Key: thumbS3Key,
      ContentType: "application/octet-stream",
    });
    const thumbPresignedUrl = await getSignedUrl(s3, thumbCommand, { expiresIn: 300 });
    thumbnailInfo = { presignedUrl: thumbPresignedUrl, s3Key: thumbS3Key };
  }

  if (input.chunkCount && input.chunkCount > 1) {
    const chunkUrls = [];
    for (let i = 0; i < input.chunkCount; i++) {
        const chunkId = randomUUID();
        const chunkS3Key = `vault/${user.id}/${input.vaultId}/chunks/${fileId}/${chunkId}.chunk`;
        const chunkCommand = new PutObjectCommand({
            Bucket: BUCKET,
            Key: chunkS3Key,
            ContentType: "application/octet-stream",
        });
        const chunkUrl = await getSignedUrl(s3, chunkCommand, { expiresIn: 600 });
        chunkUrls.push({ presignedUrl: chunkUrl, s3Key: chunkS3Key, chunkIndex: i });
    }
    return { presignedUrl, s3Key, fileId, bucket: BUCKET, chunks: chunkUrls, thumbnail: thumbnailInfo };
  }

  return { presignedUrl, s3Key, fileId, bucket: BUCKET, thumbnail: thumbnailInfo };
}

// ── Get presigned download URL for vault thumbnail ──────────
export async function getVaultThumbnailDownloadUrl(fileId: string) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const { data: file } = await supabase
    .from("vault_files")
    .select("id, thumbnail_key, s3_bucket, vaults(owner_id)")
    .eq("id", fileId)
    .single();

  if (!file || !file.thumbnail_key) return null;
  if ((file.vaults as any)?.owner_id !== userId) throw new Error("Access denied");

  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl }     = await import("@aws-sdk/s3-request-presigner");
  const { s3 }               = await import("@/lib/s3");

  const command = new GetObjectCommand({
    Bucket: file.s3_bucket,
    Key: file.thumbnail_key,
  });

  return await getSignedUrl(s3, command, { expiresIn: 3600 });
}

// ── Get presigned download URL for vault file ─────────────────
export async function getVaultDownloadUrl(fileId: string) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { data: file } = await supabase
    .from("vault_files")
    .select("id, s3_key, s3_bucket, name, is_fragmented, chunk_count, vaults(owner_id)")
    .eq("id", fileId)
    .single();

  if (!file) throw new Error("File not found");
  if ((file.vaults as any)?.owner_id !== user.id) throw new Error("Access denied");

  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl }     = await import("@aws-sdk/s3-request-presigner");
  const { s3 }               = await import("@/lib/s3");

  if (file.is_fragmented) {
    const { data: chunks, error: chunkError } = await supabase
        .from("vault_file_chunks")
        .select("s3_key, chunk_index, size")
        .eq("file_id", fileId)
        .order("chunk_index", { ascending: true });
    
    if (chunkError || !chunks) throw new Error("Failed to load fragments");

    const fragments = [];
    for (const chunk of chunks) {
        const command = new GetObjectCommand({
            Bucket: file.s3_bucket,
            Key: chunk.s3_key,
        });
        const url = await getSignedUrl(s3, command, { expiresIn: 600 });
        fragments.push({ url, chunkIndex: chunk.chunk_index, size: chunk.size });
    }
    return { isFragmented: true, fragments, fileName: file.name };
  }

  const command = new GetObjectCommand({
    Bucket:                     file.s3_bucket,
    Key:                        file.s3_key,
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 300 }); // short — decryption is immediate
  return { isFragmented: false, url, fileName: file.name };
}

// ── Rename vault file ─────────────────────────────────────────
export async function renameVaultFile(fileId: string, newName: string) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  // Verify ownership via vault
  const { data: file } = await supabase
    .from("vault_files")
    .select("id, vaults(owner_id)")
    .eq("id", fileId)
    .single();

  if (!file) throw new Error("File not found");
  const vaultOwner = (file.vaults as any)?.owner_id;
  if (vaultOwner !== user.id) throw new Error("Access denied");

  const { data, error } = await supabase
    .from("vault_files")
    .update({ name: newName })
    .eq("id", fileId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}