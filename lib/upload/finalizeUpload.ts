// lib/upload/finalizeUpload.ts
// Shared DB finalization for a completed upload — used by both the single-PUT
// (/api/upload/complete) and multipart (/api/upload/multipart/complete) routes.
// Handles the versioning path (archive current → file_versions, promote temp
// row) and the normal "mark complete" path.
import type { SupabaseClient } from "@supabase/supabase-js";

interface FinalizeArgs {
  supabase: SupabaseClient;
  userId: string;
  fileId: string;
  originalFileId?: string | null;
  thumbnailKey?: string | null;
}

interface FinalizeResult {
  status: number;
  body: Record<string, unknown>;
}

export async function finalizeUpload({
  supabase,
  userId,
  fileId,
  originalFileId,
  thumbnailKey,
}: FinalizeArgs): Promise<FinalizeResult> {
  // ── Versioning path ──
  if (originalFileId) {
    const { data: currentFile, error: currentFileError } = await supabase
      .from("files")
      .select("*")
      .eq("id", originalFileId)
      .eq("owner_id", userId)
      .single();

    if (currentFileError || !currentFile) {
      return { status: 404, body: { error: "Current file not found for versioning" } };
    }

    const { data: newFile, error: newFileError } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("owner_id", userId)
      .single();

    if (newFileError || !newFile) {
      return { status: 404, body: { error: "Uploaded file not found" } };
    }

    const { data: latestVersion } = await supabase
      .from("file_versions")
      .select("version_number")
      .eq("file_id", originalFileId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersionNum = (latestVersion?.version_number ?? 0) + 1;

    const { error: versionError } = await supabase.from("file_versions").insert({
      file_id: originalFileId,
      name: currentFile.name,
      mime_type: currentFile.mime_type,
      size: currentFile.size,
      s3_key: currentFile.s3_key,
      s3_bucket: currentFile.s3_bucket,
      version_number: nextVersionNum,
      created_at: currentFile.updated_at || currentFile.created_at,
    });

    if (versionError) {
      console.error("[finalizeUpload] versioning error:", versionError);
      return { status: 500, body: { error: "Failed to archive current version" } };
    }

    // Delete temp row before promoting to avoid s3_key unique collision.
    await supabase.from("files").delete().eq("id", fileId);

    const { data: updatedFile, error: updateError } = await supabase
      .from("files")
      .update({
        name: newFile.name,
        s3_key: newFile.s3_key,
        size: newFile.size,
        mime_type: newFile.mime_type,
        thumbnail_key: thumbnailKey || newFile.thumbnail_key,
        upload_status: "complete",
        updated_at: new Date().toISOString(),
      })
      .eq("id", originalFileId)
      .select()
      .single();

    if (updateError || !updatedFile) {
      console.error("[finalizeUpload] update main error:", updateError);
      return { status: 500, body: { error: "Failed to update main file" } };
    }

    return { status: 200, body: { file: updatedFile } };
  }

  // ── Normal path: mark the pending row complete ──
  const { data: file, error } = await supabase
    .from("files")
    .update({ upload_status: "complete", thumbnail_key: thumbnailKey })
    .eq("id", fileId)
    .eq("owner_id", userId)
    .in("upload_status", ["pending", "uploading"])
    .select()
    .single();

  if (error || !file) {
    console.error("[finalizeUpload] update error:", error);
    return { status: 500, body: { error: "Failed to mark file complete" } };
  }

  return { status: 200, body: { file } };
}
