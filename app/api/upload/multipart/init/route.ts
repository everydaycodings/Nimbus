// app/api/upload/multipart/init/route.ts
// Start an S3 multipart upload for a large file: insert the pending DB row
// (the storage trigger + check constraint enforce quota atomically here),
// create the multipart upload, and presign a PUT URL per part.
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "@/lib/s3";
import { randomUUID } from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const MIN_PART_SIZE = 5 * 1024 * 1024; // S3 minimum (except last part)
const BASE_PART_SIZE = 10 * 1024 * 1024;
const MAX_PARTS = 10000; // S3 hard limit
const PART_URL_TTL = 60 * 60; // 1 hour

// Pick a part size that keeps the part count under the S3 limit.
function computePartSize(size: number): number {
  let part = BASE_PART_SIZE;
  while (Math.ceil(size / part) > MAX_PARTS) part *= 2;
  return Math.max(part, MIN_PART_SIZE);
}

export async function POST(req: Request) {
  const supabaseServer = await createSupabaseClient();
  const userId = (await supabaseServer.auth.getUser()).data.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    name,
    mimeType,
    size,
    parentFolderId,
    fileId: originalFileId,
    withThumbnail,
  } = await req.json();

  if (!name || !mimeType || typeof size !== "number" || size <= 0) {
    return Response.json({ error: "Missing or invalid fields" }, { status: 400 });
  }

  if (originalFileId) {
    const { data: originalFile, error } = await supabase
      .from("files")
      .select("id")
      .eq("id", originalFileId)
      .eq("owner_id", userId)
      .single();
    if (error || !originalFile) {
      return Response.json(
        { error: "Original file not found or unauthorized" },
        { status: 404 }
      );
    }
  }

  const fileId = randomUUID();
  const ext = name.split(".").pop();
  const s3Key = `uploads/${userId}/${fileId}.${ext}`;

  // Insert the pending row. The storage_limit check constraint rejects this if
  // it would exceed the user's quota — atomic, no TOCTOU race.
  const { error: insertError } = await supabase.from("files").insert({
    id: fileId,
    name,
    mime_type: mimeType,
    size,
    s3_key: s3Key,
    s3_bucket: BUCKET,
    owner_id: userId,
    parent_folder_id: parentFolderId ?? null,
    upload_status: "pending",
  });

  if (insertError) {
    const isQuota = insertError.message?.includes("storage_limit_check");
    return Response.json(
      { error: isQuota ? "Storage limit exceeded" : "Failed to create file record" },
      { status: isQuota ? 400 : 500 }
    );
  }

  let uploadId: string | undefined;
  try {
    const created = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: BUCKET,
        Key: s3Key,
        ContentType: mimeType,
      })
    );
    uploadId = created.UploadId;
  } catch (e) {
    console.error("[multipart/init] create failed:", e);
    await supabase.from("files").delete().eq("id", fileId); // free reserved quota
    return Response.json({ error: "Failed to start upload" }, { status: 500 });
  }

  if (!uploadId) {
    await supabase.from("files").delete().eq("id", fileId);
    return Response.json({ error: "Failed to start upload" }, { status: 500 });
  }

  const partSize = computePartSize(size);
  const partCount = Math.ceil(size / partSize);

  const parts = await Promise.all(
    Array.from({ length: partCount }, async (_, i) => {
      const partNumber = i + 1;
      const url = await getSignedUrl(
        s3,
        new UploadPartCommand({
          Bucket: BUCKET,
          Key: s3Key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: PART_URL_TTL }
      );
      return { partNumber, url };
    })
  );

  let thumbnailPresignedUrl: string | null = null;
  let thumbnailKey: string | null = null;
  if (withThumbnail) {
    thumbnailKey = `thumbnails/${fileId}.webp`;
    thumbnailPresignedUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: thumbnailKey,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      }),
      { expiresIn: PART_URL_TTL }
    );
  }

  return Response.json({
    fileId,
    uploadId,
    key: s3Key,
    partSize,
    parts,
    originalFileId: originalFileId ?? null,
    thumbnailPresignedUrl,
    thumbnailKey,
  });
}
