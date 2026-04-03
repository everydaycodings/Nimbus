// app/api/upload/complete/route.ts
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: Request) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId, originalFileId } = await req.json();
  if (!fileId) {
    return Response.json({ error: "Missing fileId" }, { status: 400 });
  }

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // 1. If it's a version upload, shift data
  if (originalFileId) {
    // A. Fetch current files record (to be moved to history)
    const { data: currentFile, error: currentFileError } = await supabase
      .from("files")
      .select("*")
      .eq("id", originalFileId)
      .eq("owner_id", user.id)
      .single();

    if (currentFileError || !currentFile) {
      return Response.json({ error: "Current file not found for versioning" }, { status: 404 });
    }

    // B. Fetch new uploaded file record (temp status)
    const { data: newFile, error: newFileError } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .eq("owner_id", user.id)
      .single();

    if (newFileError || !newFile) {
      return Response.json({ error: "Uploaded file not found" }, { status: 404 });
    }

    // C. Get current max version number
    const { data: latestVersion } = await supabase
      .from("file_versions")
      .select("version_number")
      .eq("file_id", originalFileId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersionNum = (latestVersion?.version_number ?? 0) + 1;

    // D. Move current file to file_versions
    const { error: versionError } = await supabase.from("file_versions").insert({
      file_id:        originalFileId,
      name:           currentFile.name,
      mime_type:      currentFile.mime_type,
      size:           currentFile.size,
      s3_key:         currentFile.s3_key,
      s3_bucket:      currentFile.s3_bucket,
      version_number: nextVersionNum,
      created_at:     currentFile.updated_at || currentFile.created_at,
    });

    if (versionError) {
      console.error("[complete] versioning error:", versionError);
      return Response.json({ error: "Failed to archive current version" }, { status: 500 });
    }

    // E. Delete the temp file record used for upload BEFORE updating the main one
    // to avoid unique constraint violation on s3_key
    await supabase.from("files").delete().eq("id", fileId);

    // F. Update main file record with new storage info
    const { data: updatedFile, error: updateError } = await supabase
      .from("files")
      .update({
        name:          newFile.name,
        s3_key:        newFile.s3_key,
        size:          newFile.size,
        mime_type:     newFile.mime_type,
        upload_status: "complete",
        updated_at:    new Date().toISOString(),
      })
      .eq("id", originalFileId)
      .select()
      .single();

    if (updateError || !updatedFile) {
      console.error("[complete] update main error:", updateError);
      return Response.json({ error: "Failed to update main file" }, { status: 500 });
    }

    return Response.json({ file: updatedFile });
  }

  // 2. Normal upload: Just mark as complete
  const { data: file, error } = await supabase
    .from("files")
    .update({ upload_status: "complete" })
    .eq("id", fileId)
    .eq("owner_id", user.id)
    .in("upload_status", ["pending", "uploading"])
    .select()
    .single();

  if (error || !file) {
    console.error("[complete] update error:", error);
    return Response.json({ error: "Failed to mark file complete" }, { status: 500 });
  }

  return Response.json({ file });
}