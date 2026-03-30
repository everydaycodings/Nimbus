// actions/cleanup.ts
"use server";

import { createClient } from "@supabase/supabase-js";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

/**
 * Permanently deletes files and folders that have been in the trash for more than 30 days.
 */
export async function cleanupTrash() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const isoString = thirtyDaysAgo.toISOString();

  // 1. Find files to delete
  const { data: filesToDelete, error: filesError } = await supabase
    .from("files")
    .select("id, s3_key")
    .eq("is_trashed", true)
    .lt("trashed_at", isoString);

  if (filesError) {
    return { success: false, error: filesError.message };
  }

  let deletedFilesCount = 0;

  if (filesToDelete && filesToDelete.length > 0) {
    // Delete from S3 in batches (max 1000 objects per DeleteObjectsCommand)
    const BATCH_SIZE = 500;
    for (let i = 0; i < filesToDelete.length; i += BATCH_SIZE) {
      const batch = filesToDelete.slice(i, i + BATCH_SIZE);
      const keys = batch.map((f) => ({ Key: f.s3_key }));

      try {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: { Objects: keys },
          })
        );
      } catch (s3Error) {
        console.error(`[Cleanup] S3 Batch Deletion Error:`, s3Error);
      }
    }

    // Delete from Database
    const { error: dbDeleteError } = await supabase
      .from("files")
      .delete()
      .in("id", filesToDelete.map((f) => f.id));

    if (dbDeleteError) {
      console.error(`[Cleanup] Error deleting files from DB:`, dbDeleteError);
    } else {
      deletedFilesCount = filesToDelete.length;
    }
  }

  // 2. Find folders to delete
  const { data: foldersToDelete, error: foldersError } = await supabase
    .from("folders")
    .select("id")
    .eq("is_trashed", true)
    .lt("trashed_at", isoString);

  if (foldersError) {
    console.error(`[Cleanup] Error fetching folders to delete:`, foldersError);
    return { success: false, error: foldersError.message };
  }

  let deletedFoldersCount = 0;

  if (foldersToDelete && foldersToDelete.length > 0) {
    const { error: folderDeleteError } = await supabase
      .from("folders")
      .delete()
      .in("id", foldersToDelete.map((f) => f.id));

    if (folderDeleteError) {
      console.error(`[Cleanup] Error deleting folders from DB:`, folderDeleteError);
    } else {
      deletedFoldersCount = foldersToDelete.length;
    }
  }

  return { success: true, deletedFilesCount, deletedFoldersCount };
}

/**
 * Removes shared links that have expired.
 */
export async function cleanupExpiredLinks() {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("share_links")
    .delete()
    .lt("expires_at", now)
    .select("id");

  if (error) {
    console.error(`[Cleanup] Error deleting expired links:`, error);
    return { success: false, error: error.message };
  }

  const deletedCount = data?.length || 0;
  return { success: true, deletedCount };
}
