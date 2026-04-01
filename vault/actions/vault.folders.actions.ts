// vault/actions/vault.folders.actions.ts
"use server";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

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

// Verify the vault belongs to the current user
async function assertVaultOwner(vaultId: string, userId: string) {
  const { data } = await supabase
    .from("vaults")
    .select("id")
    .eq("id", vaultId)
    .eq("owner_id", userId)
    .single();
  if (!data) throw new Error("Vault not found or access denied");
}

// ── Create a folder ───────────────────────────────────────────
export async function createVaultFolder(
  vaultId:        string,
  name:           string,
  parentFolderId: string | null = null
): Promise<string> {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  await assertVaultOwner(vaultId, user.id);

  // Check for duplicate name in same parent
  const query = supabase
    .from("vault_folders")
    .select("id")
    .eq("vault_id", vaultId)
    .eq("name", name);

  const { data: existing } = await (
    parentFolderId
      ? query.eq("parent_folder_id", parentFolderId)
      : query.is("parent_folder_id", null)
  );

  if (existing && existing.length > 0) return existing[0].id;

  const { data, error } = await supabase
    .from("vault_folders")
    .insert({ vault_id: vaultId, name, parent_folder_id: parentFolderId })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id;
}

// ── List folders in a parent (null = root) ────────────────────
export async function getVaultFolders(
  vaultId:        string,
  parentFolderId: string | null = null
) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const query = supabase
    .from("vault_folders")
    .select(`
      id, name, created_at, updated_at, parent_folder_id,
      vaults!inner(owner_id)
    `)
    .eq("vault_id", vaultId)
    .eq("vaults.owner_id", userId)
    .order("name");

  const { data, error } = await (
    parentFolderId
      ? query.eq("parent_folder_id", parentFolderId)
      : query.is("parent_folder_id", null)
  );

  if (error) throw new Error(error.message);
  return (data ?? []).map(({ vaults, ...rest }) => rest);
}

// ── List files in a folder (null = root) ─────────────────────
export async function getVaultFilesInFolder(
  vaultId:        string,
  parentFolderId: string | null = null
) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const query = supabase
    .from("vault_files")
    .select(`
      id, name, original_mime_type, size, created_at, updated_at, parent_folder_id,
      vaults!inner(owner_id)
    `)
    .eq("vault_id", vaultId)
    .eq("vaults.owner_id", userId)
    .order("created_at", { ascending: false });

  const { data, error } = await (
    parentFolderId
      ? query.eq("parent_folder_id", parentFolderId)
      : query.is("parent_folder_id", null)
  );

  if (error) throw new Error(error.message);
  return (data ?? []).map(({ vaults, ...rest }) => rest);
}

// ── Delete a folder (cascades to children via DB) ─────────────
export async function deleteVaultFolder(folderId: string) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  // Verify ownership via vault
  const { data: folder } = await supabase
    .from("vault_folders")
    .select("id, vaults(owner_id)")
    .eq("id", folderId)
    .single();

  if (!folder || (folder.vaults as any)?.owner_id !== user.id) {
    throw new Error("Folder not found or access denied");
  }

  const { error } = await supabase
    .from("vault_folders")
    .delete()
    .eq("id", folderId);

  if (error) throw new Error(error.message);
}

// ── Rename a folder ───────────────────────────────────────────
export async function renameVaultFolder(folderId: string, name: string) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await getUser(userId);
  if (!user) throw new Error("User not found");

  const { data: folder } = await supabase
    .from("vault_folders")
    .select("id, vaults(owner_id)")
    .eq("id", folderId)
    .single();

  if (!folder || (folder.vaults as any)?.owner_id !== user.id) {
    throw new Error("Folder not found or access denied");
  }

  const { error } = await supabase
    .from("vault_folders")
    .update({ name })
    .eq("id", folderId);

  if (error) throw new Error(error.message);
}

export async function moveVaultFile(
  fileId: string,
  targetFolderId: string | null
) {
  const { error } = await supabase
    .from("vault_files")
    .update({ parent_folder_id: targetFolderId })
    .eq("id", fileId);

  if (error) throw new Error(error.message);
}

export async function moveVaultFolder(
  folderId: string,
  targetFolderId: string | null
) {
  // 🚫 prevent moving into itself
  if (folderId === targetFolderId) {
    throw new Error("Cannot move folder into itself");
  }

  const { error } = await supabase
    .from("vault_folders")
    .update({ parent_folder_id: targetFolderId })
    .eq("id", folderId);

  if (error) throw new Error(error.message);
}