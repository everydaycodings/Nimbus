// actions/folders.ts
"use server"

import { auth } from "@clerk/nextjs/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function getUserId(clerkId: string) {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single()
  return data
}

// ── Create folder ─────────────────────────────────────────────
export async function createFolder(
  name: string,
  parentFolderId: string | null = null
) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const user = await getUserId(userId)
  if (!user) throw new Error("User not found")

  // Check for duplicate name in same parent
  const { data: existing } = await supabase
    .from("folders")
    .select("id")
    .eq("owner_id", user.id)
    .eq("name", name)
    .eq("is_trashed", false)
    .is("parent_folder_id", parentFolderId)
    .single()

  if (existing) throw new Error(`A folder named "${name}" already exists here`)

  const { data, error } = await supabase
    .from("folders")
    .insert({
      name,
      owner_id: user.id,
      parent_folder_id: parentFolderId,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data
}

// ── Move file to a different folder ──────────────────────────
export async function moveFile(
  fileId: string,
  targetFolderId: string | null // null = move to root
) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const user = await getUserId(userId)
  if (!user) throw new Error("User not found")

  const { error } = await supabase
    .from("files")
    .update({ parent_folder_id: targetFolderId })
    .eq("id", fileId)
    .eq("owner_id", user.id)

  if (error) throw new Error(error.message)
}

// ── Move folder to a different folder ────────────────────────
export async function moveFolder(
  folderId: string,
  targetFolderId: string | null
) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const user = await getUserId(userId)
  if (!user) throw new Error("User not found")

  // Prevent moving a folder into itself or its own children
  if (folderId === targetFolderId) {
    throw new Error("Cannot move a folder into itself")
  }

  // Check target is not a descendant of the folder being moved
  if (targetFolderId) {
    const isDescendant = await checkIsDescendant(folderId, targetFolderId)
    if (isDescendant)
      throw new Error("Cannot move a folder into its own subfolder")
  }

  const { error } = await supabase
    .from("folders")
    .update({ parent_folder_id: targetFolderId })
    .eq("id", folderId)
    .eq("owner_id", user.id)

  if (error) throw new Error(error.message)
}

// ── Helper: check if targetId is a descendant of folderId ────
async function checkIsDescendant(
  folderId: string,
  targetId: string
): Promise<boolean> {
  // Walk up the tree from targetId — if we hit folderId, it's a descendant
  let currentId: string | null = targetId

  while (currentId) {
    const { data }: { data: { parent_folder_id: string | null } | null } =
      await supabase
        .from("folders")
        .select("parent_folder_id")
        .eq("id", currentId)
        .single()

    if (!data) break
    if (data.parent_folder_id === folderId) return true
    currentId = data.parent_folder_id
  }

  return false
}

// ── Get full folder tree (for move picker) ────────────────────
export async function getFolderTree(excludeFolderId?: string) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const user = await getUserId(userId)
  if (!user) throw new Error("User not found")

  const { data, error } = await supabase
    .from("folders")
    .select("id, name, parent_folder_id")
    .eq("owner_id", user.id)
    .eq("is_trashed", false)
    .order("name")

  if (error) throw new Error(error.message)

  // Exclude the folder being moved and return the rest
  return (data ?? []).filter((f) => f.id !== excludeFolderId)
}
