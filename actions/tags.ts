// actions/tags.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { Tag } from "@/types/tags";
import { revalidatePath } from "next/cache";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── Get internal user from clerk id ──────────────────────────
async function getUserId(clerkId: string) {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  return data;
}

// ── Fetch all user tags ─────────────────────────────────────
export async function getTags(): Promise<Tag[]> {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Unauthorized");

  const user = await getUserId(clerkId);
  if (!user) throw new Error("User not found");

  const { data, error } = await supabase
    .from("tags")
    .select("*")
    .eq("owner_id", user.id)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── Create a tag ────────────────────────────────────────────
export async function createTag(name: string, color: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Unauthorized");

  const user = await getUserId(clerkId);
  if (!user) throw new Error("User not found");

  const { data, error } = await supabase
    .from("tags")
    .insert({ name, color, owner_id: user.id })
    .select()
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/");
  return data;
}

// ── Update a tag ────────────────────────────────────────────
export async function updateTag(id: string, name: string, color: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Unauthorized");

  const user = await getUserId(clerkId);
  if (!user) throw new Error("User not found");

  const { error } = await supabase
    .from("tags")
    .update({ name, color })
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/");
}

// ── Delete a tag ────────────────────────────────────────────
export async function deleteTag(id: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Unauthorized");

  const user = await getUserId(clerkId);
  if (!user) throw new Error("User not found");

  const { error } = await supabase
    .from("tags")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/");
}

// ── Assign tag to item ──────────────────────────────────────
export async function assignTag(itemId: string, type: "file" | "folder", tagId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Unauthorized");

  const table = type === "file" ? "file_tags" : "folder_tags";
  const column = type === "file" ? "file_id" : "folder_id";

  const { error } = await supabase
    .from(table)
    .upsert({ [column]: itemId, tag_id: tagId }, { onConflict: `${column},tag_id` });

  if (error) throw new Error(error.message);
  revalidatePath("/");
}

// ── Unassign tag from item ──────────────────────────────────
export async function unassignTag(itemId: string, type: "file" | "folder", tagId: string) {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Unauthorized");

  const table = type === "file" ? "file_tags" : "folder_tags";
  const column = type === "file" ? "file_id" : "folder_id";

  const { error } = await supabase
    .from(table)
    .delete()
    .eq(column, itemId)
    .eq("tag_id", tagId);

  if (error) throw new Error(error.message);
  revalidatePath("/");
}
