// vault/actions/vault.actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function getUser(clerkId: string) {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  return data;
}

// ── Create vault ──────────────────────────────────────────────
// salt and verificationToken are computed client-side and passed here.
// The server stores them but NEVER sees the password.
export async function createVault(input: {
  name:              string;
  saltBase64:        string;    // random salt for PBKDF2
  verificationToken: string;    // AES-GCM encrypted token to verify password
}) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { data, error } = await supabase
    .from("vaults")
    .insert({
      name:               input.name,
      owner_id:           user.id,
      salt:               input.saltBase64,
      verification_token: input.verificationToken,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ── List vaults ───────────────────────────────────────────────
export async function getVaults() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { data, error } = await supabase
    .from("vaults")
    .select("id, name, salt, verification_token, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── Delete vault (and all its files) ─────────────────────────
export async function deleteVault(vaultId: string) {
  const { userId } = await auth();
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
export async function getVaultFiles(vaultId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  // Verify ownership
  const { data: vault } = await supabase
    .from("vaults")
    .select("id")
    .eq("id", vaultId)
    .eq("owner_id", user.id)
    .single();

  if (!vault) throw new Error("Vault not found");

  const { data, error } = await supabase
    .from("vault_files")
    .select("id, name, original_mime_type, size, s3_key, created_at")
    .eq("vault_id", vaultId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── Save vault file metadata after upload ─────────────────────
export async function saveVaultFile(input: {
  vaultId:          string;
  name:             string;
  originalMimeType: string;
  size:             number;       // original file size
  s3Key:            string;
  s3Bucket:         string;
  parentFolderId?: string | null;
}) {
  const { userId } = await auth();
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
    .insert({
      vault_id:           input.vaultId,
      name:               input.name,
      original_mime_type: input.originalMimeType,
      size:               input.size,
      s3_key:             input.s3Key,
      s3_bucket:          input.s3Bucket,
      parent_folder_id:   input.parentFolderId ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ── Delete vault file ─────────────────────────────────────────
export async function deleteVaultFile(fileId: string) {
  const { userId } = await auth();
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
}) {
  const { userId } = await auth();
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

  return { presignedUrl, s3Key, fileId, bucket: BUCKET };
}

// ── Get presigned download URL for vault file ─────────────────
export async function getVaultDownloadUrl(fileId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { data: file } = await supabase
    .from("vault_files")
    .select("id, s3_key, s3_bucket, name, vaults(owner_id)")
    .eq("id", fileId)
    .single();

  if (!file) throw new Error("File not found");
  if ((file.vaults as any)?.owner_id !== user.id) throw new Error("Access denied");

  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl }     = await import("@aws-sdk/s3-request-presigner");
  const { s3 }               = await import("@/lib/s3");

  const command = new GetObjectCommand({
    Bucket:                     file.s3_bucket,
    Key:                        file.s3_key,
    ResponseContentDisposition: `attachment; filename="${file.name}.enc"`,
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 300 }); // short — decryption is immediate
  return url;
}

// ── Rename vault file ─────────────────────────────────────────
export async function renameVaultFile(fileId: string, newName: string) {
  const { userId } = await auth();
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