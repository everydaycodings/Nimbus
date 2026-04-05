// actions/tags.ts
"use server";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { Tag } from "@/types/tags";
import { revalidatePath } from "next/cache";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── Get internal user from clerk id ──────────────────────────
async function getUserId(userId: string) {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();
  return data;
}

// ── Fetch all user tags ─────────────────────────────────────
export async function getTags(): Promise<Tag[]> {
  const supabaseServer = await createSupabaseClient();
  const { data: { user: authUser } } = await supabaseServer.auth.getUser();
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("tags")
    .select("*")
    .eq("owner_id", userId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── Create a tag ────────────────────────────────────────────
export async function createTag(name: string, color: string) {
  const supabaseServer = await createSupabaseClient();
  const { data: { user: authUser } } = await supabaseServer.auth.getUser();
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("tags")
    .insert({ name, color, owner_id: userId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return data;
}

// ── Update a tag ────────────────────────────────────────────
export async function updateTag(id: string, name: string, color: string) {
  const supabaseServer = await createSupabaseClient();
  const { data: { user: authUser } } = await supabaseServer.auth.getUser();
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const { error } = await supabase
    .from("tags")
    .update({ name, color })
    .eq("id", id)
    .eq("owner_id", userId);

  if (error) throw new Error(error.message);
  revalidatePath("/");
}

// ── Delete a tag ────────────────────────────────────────────
export async function deleteTag(id: string) {
  const supabaseServer = await createSupabaseClient();
  const { data: { user: authUser } } = await supabaseServer.auth.getUser();
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const { error } = await supabase
    .from("tags")
    .delete()
    .eq("id", id)
    .eq("owner_id", userId);

  if (error) throw new Error(error.message);
  revalidatePath("/");
}

// ── Recursive: Get all descendants of a folder ────────────────
async function getAllDescendants(folderId: string): Promise<{ folderIds: string[]; fileIds: string[] }> {
  const { data: subfolders } = await supabase
    .from("folders")
    .select("id")
    .eq("parent_folder_id", folderId)
    .eq("is_trashed", false);

  const { data: files } = await supabase
    .from("files")
    .select("id")
    .eq("parent_folder_id", folderId)
    .eq("is_trashed", false);

  let folderIds = subfolders?.map((f) => f.id) || [];
  let fileIds = files?.map((f) => f.id) || [];

  for (const subId of [...folderIds]) {
    const nested = await getAllDescendants(subId);
    folderIds.push(...nested.folderIds);
    fileIds.push(...nested.fileIds);
  }

  return { folderIds, fileIds };
}

// ── Assign tag to item ──────────────────────────────────────
export async function assignTag(itemId: string, type: "file" | "folder", tagId: string) {
  const userId = (await (await createSupabaseClient()).auth.getUser()).data.user?.id;
  if (!userId) throw new Error("Unauthorized");

  if (type === "file") {
    const { error } = await supabase
      .from("file_tags")
      .upsert({ file_id: itemId, tag_id: tagId }, { onConflict: "file_id,tag_id" });
    if (error) throw new Error(error.message);
  } else {
    // Recursive folder tagging
    const { folderIds, fileIds } = await getAllDescendants(itemId);
    const allFolderIds = [itemId, ...folderIds];

    // Batch upsert folder tags
    const folderRows = allFolderIds.map(id => ({ folder_id: id, tag_id: tagId }));
    const { error: folderError } = await supabase
      .from("folder_tags")
      .upsert(folderRows, { onConflict: "folder_id,tag_id" });
    if (folderError) throw new Error(folderError.message);

    // Batch upsert file tags
    if (fileIds.length > 0) {
      const fileRows = fileIds.map(id => ({ file_id: id, tag_id: tagId }));
      const { error: fileError } = await supabase
        .from("file_tags")
        .upsert(fileRows, { onConflict: "file_id,tag_id" });
      if (fileError) throw new Error(fileError.message);
    }
  }

  revalidatePath("/");
}

// ── Unassign tag from item ──────────────────────────────────
export async function unassignTag(itemId: string, type: "file" | "folder", tagId: string) {
  const userId = (await (await createSupabaseClient()).auth.getUser()).data.user?.id;
  if (!userId) throw new Error("Unauthorized");

  if (type === "file") {
    const { error } = await supabase
      .from("file_tags")
      .delete()
      .eq("file_id", itemId)
      .eq("tag_id", tagId);
    if (error) throw new Error(error.message);
  } else {
    // Recursive folder untagging
    const { folderIds, fileIds } = await getAllDescendants(itemId);
    const allFolderIds = [itemId, ...folderIds];

    // Batch delete folder tags
    const { error: folderError } = await supabase
      .from("folder_tags")
      .delete()
      .in("folder_id", allFolderIds)
      .eq("tag_id", tagId);
    if (folderError) throw new Error(folderError.message);

    // Batch delete file tags
    if (fileIds.length > 0) {
      const { error: fileError } = await supabase
        .from("file_tags")
        .delete()
        .in("file_id", fileIds)
        .eq("tag_id", tagId);
      if (fileError) throw new Error(fileError.message);
    }
  }

  revalidatePath("/");
}
