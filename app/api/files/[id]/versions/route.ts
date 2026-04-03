// app/api/files/[id]/versions/route.ts
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { signFiles } from "@/lib/s3-signer";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: fileId } = await params;
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify ownership of the file
  const { data: file, error: fileError } = await supabase
    .from("files")
    .select("id")
    .eq("id", fileId)
    .eq("owner_id", userId)
    .single();

  if (fileError || !file) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }

  const { data: versions, error: versionsError } = await supabase
    .from("file_versions")
    .select("*")
    .eq("file_id", fileId)
    .order("version_number", { ascending: false });

  if (versionsError) {
    return Response.json({ error: versionsError.message }, { status: 500 });
  }

  // Sign versions for download
  const signedVersions = await signFiles(versions ?? []);

  return Response.json({ versions: signedVersions });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: fileId } = await params;
  const { versionId } = await req.json();
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Fetch current file
  const { data: currentFile, error: fileError } = await supabase
    .from("files")
    .select("*")
    .eq("id", fileId)
    .eq("owner_id", userId)
    .single();

  if (fileError || !currentFile) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }

  // 2. Fetch version to restore
  const { data: versionToRestore, error: versionError } = await supabase
    .from("file_versions")
    .select("*")
    .eq("id", versionId)
    .eq("file_id", fileId)
    .single();

  if (versionError || !versionToRestore) {
    return Response.json({ error: "Version not found" }, { status: 404 });
  }

  // 3. Get next version number for archiving current
  const { data: latestVersion } = await supabase
    .from("file_versions")
    .select("version_number")
    .eq("file_id", fileId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersionNum = (latestVersion?.version_number ?? 0) + 1;

  // 4. Archive current version
  const { error: archiveError } = await supabase.from("file_versions").insert({
    file_id:        fileId,
    name:           currentFile.name,
    mime_type:      currentFile.mime_type,
    size:           currentFile.size,
    s3_key:         currentFile.s3_key,
    s3_bucket:      currentFile.s3_bucket,
    version_number: nextVersionNum,
    created_at:     currentFile.updated_at || currentFile.created_at,
  });

  if (archiveError) {
    return Response.json({ error: "Failed to archive current version" }, { status: 500 });
  }

  // 5. Update main file with version's data
  const { data: updatedFile, error: updateError } = await supabase
    .from("files")
    .update({
      name:       versionToRestore.name,
      s3_key:     versionToRestore.s3_key,
      size:       versionToRestore.size,
      mime_type:  versionToRestore.mime_type,
      updated_at: new Date().toISOString(),
    })
    .eq("id", fileId)
    .select()
    .single();

  if (updateError) {
    return Response.json({ error: "Failed to restore version" }, { status: 500 });
  }

  // 6. Delete the restored version record from history
  await supabase.from("file_versions").delete().eq("id", versionId);

  // 7. Log activity
  await supabase.from("activity_log").insert({
    user_id:       userId,
    resource_id:   fileId,
    resource_type: "file",
    action:        "version_restore",
    metadata:      { version_number: versionToRestore.version_number },
  });

  return Response.json({ file: updatedFile });
}
