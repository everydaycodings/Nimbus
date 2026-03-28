// actions/files.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── Get internal user from clerk id ──────────────────────────
async function getUserId(clerkId: string) {
  const { data } = await supabase
    .from("users")
    .select("id, storage_used, storage_limit")
    .eq("clerk_id", clerkId)
    .single();
  return data;
}

// ── Fetch files + folders in a given folder (null = root) ────
export async function getFiles(
  parentFolderId: string | null = null,
  options?: {
    page?: number;
    query?: string;
  }
) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  const page = options?.page ?? 1;
  const query = options?.query;

  const PAGE_SIZE = 20;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // ── FOLDERS ─────────────────────────────────────
  let folderQuery = supabase
    .from("folders")
    .select("id, name, created_at, is_starred, parent_folder_id")
    .eq("owner_id", user.id)
    .eq("is_trashed", false)
    .order("name", { ascending: true });

  folderQuery = parentFolderId
    ? folderQuery.eq("parent_folder_id", parentFolderId)
    : folderQuery.is("parent_folder_id", null);

  if (query) {
    folderQuery = folderQuery.ilike("name", `%${query}%`);
  }

  const { data: folders, error: folderError } = await folderQuery;
  if (folderError) throw new Error(folderError.message);

  // ── FILES ───────────────────────────────────────
  let fileQuery = supabase
    .from("files")
    .select("id, name, mime_type, size, created_at, is_starred, parent_folder_id, s3_key")
    .eq("owner_id", user.id)
    .eq("is_trashed", false)
    .eq("upload_status", "complete")
    .order("created_at", { ascending: false })
    .range(from, to);

  fileQuery = parentFolderId
    ? fileQuery.eq("parent_folder_id", parentFolderId)
    : fileQuery.is("parent_folder_id", null);

  if (query) {
    fileQuery = fileQuery.ilike("name", `%${query}%`);
  }

  const { data: files, error: fileError } = await fileQuery;
  if (fileError) throw new Error(fileError.message);

  return {
    folders: folders ?? [],
    files: files ?? [],
    user,
  };
}

// ── Fetch starred files + folders ────────────────────────────
export async function getStarredItems() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  const [{ data: folders }, { data: files }] = await Promise.all([
    supabase
      .from("folders")
      .select("id, name, created_at, is_starred")
      .eq("owner_id", user.id)
      .eq("is_starred", true)
      .eq("is_trashed", false)
      .order("name"),
    supabase
      .from("files")
      .select("id, name, mime_type, size, created_at, is_starred, s3_key")
      .eq("owner_id", user.id)
      .eq("is_starred", true)
      .eq("is_trashed", false)
      .eq("upload_status", "complete")
      .order("created_at", { ascending: false }),
  ]);

  return { folders: folders ?? [], files: files ?? [] };
}

// ── Fetch trashed items ───────────────────────────────────────
export async function getTrashedItems() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  const [{ data: folders }, { data: files }] = await Promise.all([
    supabase
      .from("folders")
      .select("id, name, trashed_at")
      .eq("owner_id", user.id)
      .eq("is_trashed", true)
      .order("trashed_at", { ascending: false }),
    supabase
      .from("files")
      .select("id, name, mime_type, size, trashed_at, s3_key")
      .eq("owner_id", user.id)
      .eq("is_trashed", true)
      .order("trashed_at", { ascending: false }),
  ]);

  return { folders: folders ?? [], files: files ?? [] };
}

// ── Toggle star ───────────────────────────────────────────────
export async function toggleStar(
  id:      string,
  type:    "file" | "folder",
  starred: boolean
) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  const table = type === "file" ? "files" : "folders";

  const { error } = await supabase
    .from(table)
    .update({ is_starred: !starred })
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) throw new Error(error.message);
}

// ── Move to trash ─────────────────────────────────────────────
export async function trashItem(id: string, type: "file" | "folder") {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  const table = type === "file" ? "files" : "folders";

  const { error } = await supabase
    .from(table)
    .update({ is_trashed: true })
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) throw new Error(error.message);
}

// ── Restore from trash ────────────────────────────────────────
export async function restoreItem(id: string, type: "file" | "folder") {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  const table = type === "file" ? "files" : "folders";

  const { error } = await supabase
    .from(table)
    .update({ is_trashed: false })
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) throw new Error(error.message);
}

// ── Rename ────────────────────────────────────────────────────
export async function renameItem(
  id:   string,
  type: "file" | "folder",
  name: string
) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  const table = type === "file" ? "files" : "folders";

  const { error } = await supabase
    .from(table)
    .update({ name })
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) throw new Error(error.message);
}

// ── Fetch 20 most recently uploaded files ─────────────────────
export async function getRecentFiles() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  const { data, error } = await supabase
    .from("files")
    .select("id, name, mime_type, size, created_at, is_starred, s3_key, parent_folder_id")
    .eq("owner_id", user.id)
    .eq("is_trashed", false)
    .eq("upload_status", "complete")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);
  return data ?? [];
}