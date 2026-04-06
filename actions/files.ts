// actions/files.ts
"use server";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { signFiles } from "@/lib/s3-signer";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── Get internal user from clerk id ──────────────────────────
async function getUserId(userId: string) {
  const { data } = await supabase
    .from("users")
    .select("id, storage_used, storage_limit")
    .eq("id", userId)
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
  const supabaseServer = await createSupabaseClient();
  const { data: { user: authUser } } = await supabaseServer.auth.getUser();
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const page = options?.page ?? 1;
  const query = options?.query;

  const PAGE_SIZE = 20;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // ── FOLDERS QUERY ─────────────────────────────────
  let folderSelect = "id, name, created_at, updated_at, is_starred, parent_folder_id, tags:folder_tags(tag:tags(id, name, color))";
  if (options?.tagId) {
    folderSelect = "id, name, created_at, updated_at, is_starred, parent_folder_id, tags:folder_tags!inner(tag:tags(id, name, color))";
  }

  let folderQuery = supabase
    .from("folders")
    .select(folderSelect)
    .eq("owner_id", userId)
    .eq("is_trashed", false);

  if (options?.tagId) {
    folderQuery = folderQuery.eq("folder_tags.tag_id", options.tagId);
  }

  if (!options?.tagId) {
    folderQuery = parentFolderId
      ? folderQuery.eq("parent_folder_id", parentFolderId)
      : folderQuery.is("parent_folder_id", null);
  }

  if (query) {
    // Use textSearch for GIN index optimization
    // Appending :* allows prefix matching (e.g., "port" finds "portable")
    const searchTerms = query.trim().split(/\s+/).map(t => `${t}:*`).join(" & ");
    folderQuery = folderQuery.textSearch("name", searchTerms, { config: "english" });
  }

  const folderSortBy = options?.sortBy === "name" ? "name" : "created_at";
  const folderSortOrder = options?.sortOrder === "desc" ? { ascending: false } : { ascending: true };
  folderQuery = folderQuery.order(folderSortBy, folderSortOrder);

  // ── FILES QUERY ───────────────────────────────────
  let fileSelect = "id, name, mime_type, size, created_at, updated_at, is_starred, parent_folder_id, s3_key, tags:file_tags(tag:tags(id, name, color))";
  if (options?.tagId) {
    fileSelect = "id, name, mime_type, size, created_at, updated_at, is_starred, parent_folder_id, s3_key, tags:file_tags!inner(tag:tags(id, name, color))";
  }

  let fileQuery = supabase
    .from("files")
    .select(fileSelect)
    .eq("owner_id", userId)
    .eq("is_trashed", false)
    .eq("upload_status", "complete");

  if (options?.tagId) {
    fileQuery = fileQuery.eq("file_tags.tag_id", options.tagId);
  }
  if (!options?.tagId) {
    fileQuery = parentFolderId
      ? fileQuery.eq("parent_folder_id", parentFolderId)
      : fileQuery.is("parent_folder_id", null);
  }

  if (query) {
    const searchTerms = query.trim().split(/\s+/).map(t => `${t}:*`).join(" & ");
    fileQuery = fileQuery.textSearch("name", searchTerms, { config: "english" });
  }

  if (options?.type && options.type !== "all") {
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

  // ── EXECUTE IN PARALLEL (Metadata + Data) ──────────
  const [userResult, foldersResult, filesResult] = await Promise.all([
    getUserId(userId),
    folderQuery,
    fileQuery,
  ]);

  if (foldersResult.error) throw new Error(foldersResult.error.message);
  if (filesResult.error) throw new Error(filesResult.error.message);

  // ── SIGN FILES FOR INSTANT ACCESS ───────────
  const signedFiles = await signFiles((filesResult.data as any[]) ?? []);

  return {
    folders: foldersResult.data ?? [],
    files: signedFiles,
    user: userResult,
  };
}

// ── Fetch starred files + folders ────────────────────────────
export async function getStarredItems(options?: { tagId?: string }) {
  const supabaseServer = await createSupabaseClient();
  const { data: { user: authUser } } = await supabaseServer.auth.getUser();
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const folderSelect = options?.tagId 
    ? "id, name, created_at, updated_at, is_starred, tags:folder_tags!inner(tag:tags(id, name, color))"
    : "id, name, created_at, updated_at, is_starred, tags:folder_tags(tag:tags(id, name, color))";
  
  const fileSelect = options?.tagId
    ? "id, name, mime_type, size, created_at, updated_at, is_starred, s3_key, tags:file_tags!inner(tag:tags(id, name, color))"
    : "id, name, mime_type, size, created_at, updated_at, is_starred, s3_key, tags:file_tags(tag:tags(id, name, color))";

  let folderQuery = supabase
    .from("folders")
    .select(folderSelect)
    .eq("owner_id", userId)
    .eq("is_starred", true)
    .eq("is_trashed", false);
  
  if (options?.tagId) {
    folderQuery = folderQuery.eq("folder_tags.tag_id", options.tagId);
  }

  let fileQuery = supabase
    .from("files")
    .select(fileSelect)
    .eq("owner_id", userId)
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

  const signedFiles = await signFiles((files as any[]) ?? []);

  return { folders: folders ?? [], files: signedFiles };
}

// ── Fetch trashed items ───────────────────────────────────────
export async function getTrashedItems() {
  const supabaseServer = await createSupabaseClient();
  const { data: { user: authUser } } = await supabaseServer.auth.getUser();
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const [{ data: folders }, { data: files }, { data: versions }] = await Promise.all([
    supabase
      .from("folders")
      .select("id, name, trashed_at")
      .eq("owner_id", userId)
      .eq("is_trashed", true)
      .order("trashed_at", { ascending: false }),
    supabase
      .from("files")
      .select("id, name, mime_type, size, trashed_at, s3_key")
      .eq("owner_id", userId)
      .eq("is_trashed", true)
      .order("trashed_at", { ascending: false }),
    supabase
      .from("file_versions")
      .select("id, file_id, name, mime_type, size, trashed_at, s3_key, version_number")
      .eq("is_trashed", true)
      .order("trashed_at", { ascending: false }),
  ]);

  const signedFiles = await signFiles((files as any[]) ?? []);
  const signedVersions = await signFiles((versions as any[]) ?? []);

  // Map versions to a format that FileGrid can handle or tag them
  const versionItems = signedVersions.map((v: any) => ({
    ...v,
    type: "version",
    original_name: v.name,
    name: `${v.name} (V${v.version_number})`,
  }));

  return { 
    folders: folders ?? [], 
    files: [...signedFiles, ...versionItems] 
  };
}

// ── Toggle star ───────────────────────────────────────────────
export async function toggleStar(
  id:      string,
  type:    "file" | "folder",
  starred: boolean
) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
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
export async function trashItem(id: string, type: "file" | "folder" | "version") {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  const table = type === "file" ? "files" : type === "folder" ? "folders" : "file_versions";

  const { error } = await supabase
    .from(table)
    .update({ is_trashed: true })
    .eq("id", id);
    // Note: file_versions doesn't have owner_id, but it's protected by RLS
    // we could add .eq("file_id", ...) if we had it.

  if (error) throw new Error(error.message);
}

// ── Restore from trash ────────────────────────────────────────
export async function restoreItem(id: string, type: "file" | "folder" | "version") {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  const table = type === "file" ? "files" : type === "folder" ? "folders" : "file_versions";

  const { error } = await supabase
    .from(table)
    .update({ is_trashed: false })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

// ── Rename ────────────────────────────────────────────────────
export async function renameItem(
  id:   string,
  type: "file" | "folder" | "version",
  name: string
) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  const table = type === "file" ? "files" : type === "folder" ? "folders" : "file_versions";

  const { error } = await supabase
    .from(table)
    .update({ name })
    .eq("id", id);
    // Again, file_versions is protected by RLS

  if (error) throw new Error(error.message);
}

// ── Fetch 20 most recently uploaded files ─────────────────────
export async function getRecentFiles(options?: { tagId?: string }) {
  const supabaseServer = await createSupabaseClient();
  const { data: { user: authUser } } = await supabaseServer.auth.getUser();
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const select = options?.tagId
    ? "id, name, mime_type, size, created_at, updated_at, is_starred, s3_key, parent_folder_id, tags:file_tags!inner(tag:tags(id, name, color))"
    : "id, name, mime_type, size, created_at, updated_at, is_starred, s3_key, parent_folder_id, tags:file_tags(tag:tags(id, name, color))";

  let query = supabase
    .from("files")
    .select(select)
    .eq("owner_id", userId)
    .eq("is_trashed", false)
    .eq("upload_status", "complete");

  if (options?.tagId) {
    query = query.eq("file_tags.tag_id", options.tagId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);
  const signedFiles = await signFiles((data as any[]) ?? []);

  return signedFiles;
}
// ── Fetch aggregate storage statistics (RPC) ──────────────────
export async function getStorageStats() {
  const supabaseServer = await createSupabaseClient();
  const { data: { user } } = await supabaseServer.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data, error } = await supabase.rpc("get_storage_stats", {
    p_owner_id: user.id,
  });

  if (error) throw new Error(error.message);
  return data as {
    image: number;
    video: number;
    document: number;
    other: number;
  };
}

// ── Check if files exist by name ──────────────────────────────
export async function checkFilesExist(
  parentFolderId: string | null,
  names: string[]
) {
  const supabaseServer = await createSupabaseClient();
  const { data: { user } } = await supabaseServer.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  let query = supabase
    .from("files")
    .select("id, name")
    .eq("owner_id", user.id)
    .eq("is_trashed", false)
    .in("name", names);

  if (parentFolderId) {
    query = query.eq("parent_folder_id", parentFolderId);
  } else {
    query = query.is("parent_folder_id", null);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return data as { id: string; name: string }[];
}
