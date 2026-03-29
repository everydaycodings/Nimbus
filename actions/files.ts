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
    type?: string;
    sortBy?: string;
    sortOrder?: string;
    minSize?: number;
    maxSize?: number;
    tagId?: string;
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
  let folderSelect = "id, name, created_at, updated_at, is_starred, parent_folder_id, tags:folder_tags(tag:tags(id, name, color))";
  if (options?.tagId) {
    folderSelect = "id, name, created_at, updated_at, is_starred, parent_folder_id, tags:folder_tags!inner(tag:tags(id, name, color))";
  }

  let folderQuery = supabase
    .from("folders")
    .select(folderSelect)
    .eq("owner_id", user.id)
    .eq("is_trashed", false);

  if (options?.tagId) {
    folderQuery = folderQuery.eq("folder_tags.tag_id", options.tagId);
  }

  folderQuery = parentFolderId
    ? folderQuery.eq("parent_folder_id", parentFolderId)
    : folderQuery.is("parent_folder_id", null);

  if (query) {
    folderQuery = folderQuery.ilike("name", `%${query}%`);
  }

  // Sorting folders (only by name for now as they have no size/type)
  const sortBy = options?.sortBy === "name" ? "name" : "created_at";
  const sortOrder = options?.sortOrder === "desc" ? { ascending: false } : { ascending: true };
  folderQuery = folderQuery.order(sortBy, sortOrder);

  const { data: folders, error: folderError } = await folderQuery;
  if (folderError) throw new Error(folderError.message);

  // ── FILES ───────────────────────────────────────
  let fileSelect = "id, name, mime_type, size, created_at, updated_at, is_starred, parent_folder_id, s3_key, tags:file_tags(tag:tags(id, name, color))";
  if (options?.tagId) {
    fileSelect = "id, name, mime_type, size, created_at, updated_at, is_starred, parent_folder_id, s3_key, tags:file_tags!inner(tag:tags(id, name, color))";
  }

  let fileQuery = supabase
    .from("files")
    .select(fileSelect)
    .eq("owner_id", user.id)
    .eq("is_trashed", false)
    .eq("upload_status", "complete");

  if (options?.tagId) {
    fileQuery = fileQuery.eq("file_tags.tag_id", options.tagId);
  }
  fileQuery = parentFolderId
    ? fileQuery.eq("parent_folder_id", parentFolderId)
    : fileQuery.is("parent_folder_id", null);

  if (query) {
    fileQuery = fileQuery.ilike("name", `%${query}%`);
  }

  if (options?.type && options.type !== "all") {
    // We can't easily use FILE_TYPE_MAP here because it's in a different file
    // and this is a server action. I'll pass the mime types directly or handle it here.
    if (options.type === "image") fileQuery = fileQuery.ilike("mime_type", "image/%");
    else if (options.type === "video") fileQuery = fileQuery.ilike("mime_type", "video/%");
    else if (options.type === "audio") fileQuery = fileQuery.ilike("mime_type", "audio/%");
    else if (options.type === "document") {
      fileQuery = fileQuery.in("mime_type", [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
      ]);
    }
  }

  if (options?.minSize !== undefined) fileQuery = fileQuery.gte("size", options.minSize);
  if (options?.maxSize !== undefined) fileQuery = fileQuery.lte("size", options.maxSize);

  const fileSortBy = options?.sortBy || "created_at";
  const fileSortOrder = options?.sortOrder === "asc" ? { ascending: true } : { ascending: false };
  fileQuery = fileQuery.order(fileSortBy, fileSortOrder).range(from, to);

  const { data: files, error: fileError } = await fileQuery;
  if (fileError) throw new Error(fileError.message);

  return {
    folders: folders ?? [],
    files: files ?? [],
    user,
  };
}

// ── Fetch starred files + folders ────────────────────────────
export async function getStarredItems(options?: { tagId?: string }) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  const folderSelect = options?.tagId 
    ? "id, name, created_at, updated_at, is_starred, tags:folder_tags!inner(tag:tags(id, name, color))"
    : "id, name, created_at, updated_at, is_starred, tags:folder_tags(tag:tags(id, name, color))";
  
  const fileSelect = options?.tagId
    ? "id, name, mime_type, size, created_at, updated_at, is_starred, s3_key, tags:file_tags!inner(tag:tags(id, name, color))"
    : "id, name, mime_type, size, created_at, updated_at, is_starred, s3_key, tags:file_tags(tag:tags(id, name, color))";

  let folderQuery = supabase
    .from("folders")
    .select(folderSelect)
    .eq("owner_id", user.id)
    .eq("is_starred", true)
    .eq("is_trashed", false);
  
  if (options?.tagId) {
    folderQuery = folderQuery.eq("folder_tags.tag_id", options.tagId);
  }

  let fileQuery = supabase
    .from("files")
    .select(fileSelect)
    .eq("owner_id", user.id)
    .eq("is_starred", true)
    .eq("is_trashed", false)
    .eq("upload_status", "complete");

  if (options?.tagId) {
    fileQuery = fileQuery.eq("file_tags.tag_id", options.tagId);
  }

  const [{ data: folders }, { data: files }] = await Promise.all([
    folderQuery.order("name"),
    fileQuery.order("created_at", { ascending: false }),
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
export async function getRecentFiles(options?: { tagId?: string }) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  const select = options?.tagId
    ? "id, name, mime_type, size, created_at, updated_at, is_starred, s3_key, parent_folder_id, tags:file_tags!inner(tag:tags(id, name, color))"
    : "id, name, mime_type, size, created_at, updated_at, is_starred, s3_key, parent_folder_id, tags:file_tags(tag:tags(id, name, color))";

  let query = supabase
    .from("files")
    .select(select)
    .eq("owner_id", user.id)
    .eq("is_trashed", false)
    .eq("upload_status", "complete");

  if (options?.tagId) {
    query = query.eq("file_tags.tag_id", options.tagId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);
  return data ?? [];
}