// actions/files.ts
"use server"

import { auth } from "@clerk/nextjs/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Get internal user id from clerk id ───────────────────────
async function getUserId(clerkId: string) {
  const { data } = await supabase
    .from("users")
    .select("id, storage_used, storage_limit")
    .eq("clerk_id", clerkId)
    .single()
  return data
}

// ── Fetch files + folders in a given folder (null = root) ────
export async function getFiles(parentFolderId: string | null = null) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const user = await getUserId(userId)
  if (!user) throw new Error("User not found")

  // Fetch folders first
  const { data: folders, error: folderError } = await supabase
    .from("folders")
    .select("id, name, created_at, is_starred, parent_folder_id")
    .eq("owner_id", user.id)
    .eq("is_trashed", false)
    .eq("parent_folder_id", parentFolderId ?? "") // workaround: see note below
    .order("name", { ascending: true })

  // Fetch files
  const query = supabase
    .from("files")
    .select("id, name, mime_type, size, created_at, is_starred, s3_key")
    .eq("owner_id", user.id)
    .eq("is_trashed", false)
    .eq("upload_status", "complete")
    .order("created_at", { ascending: false })

  const { data: files } = parentFolderId
    ? await query.eq("parent_folder_id", parentFolderId)
    : await query.is("parent_folder_id", null)

  return {
    folders: folders ?? [],
    files: files ?? [],
    user,
  }
}

// ── Fetch starred files + folders ────────────────────────────
export async function getStarredItems() {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const user = await getUserId(userId)
  if (!user) throw new Error("User not found")

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
  ])

  return { folders: folders ?? [], files: files ?? [] }
}

// ── Fetch trashed items ───────────────────────────────────────
export async function getTrashedItems() {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const user = await getUserId(userId)
  if (!user) throw new Error("User not found")

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
  ])

  return { folders: folders ?? [], files: files ?? [] }
}

// ── Toggle star ───────────────────────────────────────────────
export async function toggleStar(
  id: string,
  type: "file" | "folder",
  starred: boolean
) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const user = await getUserId(userId)
  if (!user) throw new Error("User not found")

  const table = type === "file" ? "files" : "folders"

  const { error } = await supabase
    .from(table)
    .update({ is_starred: !starred })
    .eq("id", id)
    .eq("owner_id", user.id)

  if (error) throw new Error(error.message)
}

// ── Move to trash ─────────────────────────────────────────────
export async function trashItem(id: string, type: "file" | "folder") {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const user = await getUserId(userId)
  if (!user) throw new Error("User not found")

  const table = type === "file" ? "files" : "folders"

  const { error } = await supabase
    .from(table)
    .update({ is_trashed: true })
    .eq("id", id)
    .eq("owner_id", user.id)

  if (error) throw new Error(error.message)
}

// ── Restore from trash ────────────────────────────────────────
export async function restoreItem(id: string, type: "file" | "folder") {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const user = await getUserId(userId)
  if (!user) throw new Error("User not found")

  const table = type === "file" ? "files" : "folders"

  const { error } = await supabase
    .from(table)
    .update({ is_trashed: false })
    .eq("id", id)
    .eq("owner_id", user.id)

  if (error) throw new Error(error.message)
}

// ── Rename ────────────────────────────────────────────────────
export async function renameItem(
  id: string,
  type: "file" | "folder",
  name: string
) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const user = await getUserId(userId)
  if (!user) throw new Error("User not found")

  const table = type === "file" ? "files" : "folders"

  const { error } = await supabase
    .from(table)
    .update({ name })
    .eq("id", id)
    .eq("owner_id", user.id)

  if (error) throw new Error(error.message)
}
