// actions/trash.ts
"use server";

import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function emptyTrash() {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();

  if (!user) throw new Error("User not found");

  // Get all trashed files + versions (need s3_key to delete from S3)
  const [{ data: files }, { data: versions }] = await Promise.all([
    supabase
      .from("files")
      .select("id, s3_key")
      .eq("owner_id", user.id)
      .eq("is_trashed", true),
    supabase
      .from("file_versions")
      .select("id, s3_key")
      .eq("is_trashed", true)
  ]);

  // Combine S3 keys to delete
  const keysToDelete = [
    ...(files || []).map(f => f.s3_key),
    ...(versions || []).map(v => v.s3_key)
  ];

  if (keysToDelete.length > 0) {
    await Promise.allSettled(
      keysToDelete.map(key =>
        s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
      )
    );
  }

  // Delete from Supabase
  if (files && files.length > 0) {
    await supabase
      .from("files")
      .delete()
      .eq("owner_id", user.id)
      .eq("is_trashed", true);
  }

  if (versions && versions.length > 0) {
    await supabase
      .from("file_versions")
      .delete()
      .eq("is_trashed", true);
  }

  // Delete trashed folders
  await supabase
    .from("folders")
    .delete()
    .eq("owner_id", user.id)
    .eq("is_trashed", true);
}

export async function deleteItemPermanently(
  id: string,
  type: "file" | "folder" | "version"
) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) throw new Error("Unauthorized");

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();

  if (!user) throw new Error("User not found");

  const keysToDelete: string[] = [];

  if (type === "file" || type === "version") {
    const table = type === "file" ? "files" : "file_versions";
    const { data: item } = await supabase
      .from(table)
      .select("id, s3_key, thumbnail_key")
      .eq("id", id)
      .single();

    if (item) {
      if (item.s3_key) keysToDelete.push(item.s3_key);
      if (item.thumbnail_key) keysToDelete.push(item.thumbnail_key);
    }

    // Delete from Supabase
    await supabase.from(table).delete().eq("id", id);
  } else if (type === "folder") {
    // 1. Get all folders for this user to build subtree
    const { data: allFolders } = await supabase
      .from("folders")
      .select("id, parent_folder_id")
      .eq("owner_id", user.id);

    // 2. Identify all descendants of the target folder
    const folderIds = new Set<string>([id]);
    const toProcess = [id];
    
    while (toProcess.length > 0) {
      const currentId = toProcess.shift()!;
      const children = (allFolders || []).filter(f => f.parent_folder_id === currentId);
      for (const child of children) {
        if (!folderIds.has(child.id)) {
          folderIds.add(child.id);
          toProcess.push(child.id);
        }
      }
    }
    
    const allFolderIds = Array.from(folderIds);

    // 3. Get all files in these folders
    const { data: files } = await supabase
      .from("files")
      .select("id, s3_key, thumbnail_key")
      .in("parent_folder_id", allFolderIds);

    const fileIds = (files || []).map(f => f.id);
    (files || []).forEach(f => {
      if (f.s3_key) keysToDelete.push(f.s3_key);
      if (f.thumbnail_key) keysToDelete.push(f.thumbnail_key);
    });

    // 4. Get all file versions in these folders
    if (fileIds.length > 0) {
      const { data: versions } = await supabase
        .from("file_versions")
        .select("s3_key, thumbnail_key")
        .in("file_id", fileIds);

      (versions || []).forEach(v => {
        if (v.s3_key) keysToDelete.push(v.s3_key);
        if (v.thumbnail_key) keysToDelete.push(v.thumbnail_key);
      });
    }

    // 5. Delete the target folder (cascade will handle DB records)
    await supabase.from("folders").delete().eq("id", id).eq("owner_id", user.id);
  }

  // Delete from S3
  if (keysToDelete.length > 0) {
    await Promise.allSettled(
      keysToDelete.map((key) =>
        s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
      )
    );
  }
}