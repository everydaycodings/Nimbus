// app/api/upload/multipart/complete/route.ts
// Finish an S3 multipart upload, then run the shared DB finalization
// (versioning or mark-complete), identical to the single-PUT path.
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import { s3, BUCKET } from "@/lib/s3";
import { finalizeUpload } from "@/lib/upload/finalizeUpload";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface PartInput {
  PartNumber: number;
  ETag: string;
}

export async function POST(req: Request) {
  const supabaseServer = await createSupabaseClient();
  const userId = (await supabaseServer.auth.getUser()).data.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId, uploadId, parts, originalFileId, thumbnailKey } = await req.json();
  if (!fileId || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return Response.json({ error: "Missing fileId, uploadId, or parts" }, { status: 400 });
  }

  // Confirm ownership + get the key for the multipart completion.
  const { data: file } = await supabase
    .from("files")
    .select("s3_key")
    .eq("id", fileId)
    .eq("owner_id", userId)
    .single();

  if (!file) {
    return Response.json({ error: "Uploaded file not found" }, { status: 404 });
  }

  const orderedParts = (parts as PartInput[])
    .slice()
    .sort((a, b) => a.PartNumber - b.PartNumber);

  try {
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: BUCKET,
        Key: file.s3_key,
        UploadId: uploadId,
        MultipartUpload: { Parts: orderedParts },
      })
    );
  } catch (e) {
    console.error("[multipart/complete] complete failed:", e);
    return Response.json({ error: "Failed to assemble upload" }, { status: 500 });
  }

  const result = await finalizeUpload({
    supabase,
    userId,
    fileId,
    originalFileId,
    thumbnailKey,
  });

  return Response.json(result.body, { status: result.status });
}
