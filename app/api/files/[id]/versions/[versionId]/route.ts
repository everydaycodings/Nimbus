// app/api/files/[id]/versions/[versionId]/route.ts
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const { id: fileId, versionId } = await params;
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Fetch version to delete
  const { data: versionToDelete, error: versionError } = await supabase
    .from("file_versions")
    .select("*")
    .eq("id", versionId)
    .eq("file_id", fileId)
    .single();

  if (versionError || !versionToDelete) {
    return Response.json({ error: "Version not found" }, { status: 404 });
  }

  // 2. Delete from S3
  try {
    const command = new DeleteObjectCommand({
      Bucket: versionToDelete.s3_bucket || BUCKET,
      Key:    versionToDelete.s3_key,
    });
    await s3.send(command);
  } catch (err) {
    console.error("[version delete] S3 delete error:", err);
    // Continue even if S3 delete fails (orphaned object)
  }

  // 3. Delete from database
  const { error: dbError } = await supabase
    .from("file_versions")
    .delete()
    .eq("id", versionId);

  if (dbError) {
    return Response.json({ error: dbError.message }, { status: 500 });
  }

  // 4. Log activity
  await supabase.from("activity_log").insert({
    user_id:       userId,
    resource_id:   fileId,
    resource_type: "file",
    action:        "version_delete",
    metadata:      { version_number: versionToDelete.version_number },
  });

  return Response.json({ success: true });
}
