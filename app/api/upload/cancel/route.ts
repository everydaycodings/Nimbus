// app/api/upload/cancel/route.ts
// Cancel/cleanup an upload. Unlike before, this fully cleans up so failed or
// cancelled uploads don't leak S3 objects OR storage quota:
//   - aborts the S3 multipart upload (if uploadId given) to drop staged parts
//   - deletes the uploaded object + thumbnail from S3 (single-PUT case)
//   - deletes the pending DB row, which (via trg_storage_used) frees the quota
//     that was reserved when the row was inserted at presign/init time.
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import {
  DeleteObjectCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: Request) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const userId = authUserResponse.data.user?.id;

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId, uploadId } = await req.json();

  if (!fileId) {
    return Response.json({ error: "Missing fileId" }, { status: 400 });
  }

  // Fetch the pending row (scoped to owner) so we know what to remove from S3.
  const { data: file } = await supabase
    .from("files")
    .select("id, s3_key, thumbnail_key, upload_status")
    .eq("id", fileId)
    .eq("owner_id", userId)
    .in("upload_status", ["pending", "uploading"])
    .single();

  // Nothing pending to clean up (already completed or already cleaned).
  if (!file) {
    return Response.json({ success: true });
  }

  // Best-effort S3 cleanup — never block the DB cleanup on these.
  const s3Cleanup: Promise<unknown>[] = [];

  if (uploadId) {
    s3Cleanup.push(
      s3
        .send(
          new AbortMultipartUploadCommand({
            Bucket: BUCKET,
            Key: file.s3_key,
            UploadId: uploadId,
          })
        )
        .catch((e) => console.error("[cancel] abort multipart failed", e))
    );
  }

  s3Cleanup.push(
    s3
      .send(new DeleteObjectCommand({ Bucket: BUCKET, Key: file.s3_key }))
      .catch((e) => console.error("[cancel] delete object failed", e))
  );

  if (file.thumbnail_key) {
    s3Cleanup.push(
      s3
        .send(new DeleteObjectCommand({ Bucket: BUCKET, Key: file.thumbnail_key }))
        .catch((e) => console.error("[cancel] delete thumbnail failed", e))
    );
  }

  await Promise.all(s3Cleanup);

  // Delete the row — frees the reserved quota via the storage trigger.
  const { error } = await supabase
    .from("files")
    .delete()
    .eq("id", fileId)
    .eq("owner_id", userId)
    .in("upload_status", ["pending", "uploading"]);

  if (error) {
    return Response.json({ error: "Failed to cancel upload" }, { status: 500 });
  }

  return Response.json({ success: true });
}
