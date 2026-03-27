// actions/uploadFolder.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function getUserId(clerkId: string) {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  return data;
}

// Creates a folder and returns its id
// parentFolderId = null means root
export async function createFolderForUpload(
  name: string,
  parentFolderId: string | null
): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await getUserId(userId);
  if (!user) throw new Error("User not found");

  // Check if folder with same name already exists in this parent
  const query = supabase
    .from("folders")
    .select("id")
    .eq("owner_id", user.id)
    .eq("name", name)
    .eq("is_trashed", false);

  const { data: existing } = await (
    parentFolderId
      ? query.eq("parent_folder_id", parentFolderId)
      : query.is("parent_folder_id", null)
  );

  // Reuse existing folder instead of creating a duplicate
  if (existing && existing.length > 0) return existing[0].id;

  const { data, error } = await supabase
    .from("folders")
    .insert({
      name,
      owner_id:         user.id,
      parent_folder_id: parentFolderId,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id;
}