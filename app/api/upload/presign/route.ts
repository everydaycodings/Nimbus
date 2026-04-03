// app/api/upload/presign/route.ts
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "@/lib/s3";
import { randomUUID } from "crypto";

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

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, storage_used, storage_limit")
    .eq("id", userId)
    .single();

  if (userError || !user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const { name, mimeType, size, parentFolderId, fileId: originalFileId } = await req.json();

  if (!name || !mimeType || !size) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  // If originalFileId is provided, verify ownership
  if (originalFileId) {
    const { data: originalFile, error: originalFileError } = await supabase
      .from("files")
      .select("id")
      .eq("id", originalFileId)
      .eq("owner_id", user.id)
      .single();

    if (originalFileError || !originalFile) {
      return Response.json({ error: "Original file not found or unauthorized" }, { status: 404 });
    }
  }

  if (user.storage_used + size > user.storage_limit) {
    return Response.json({ error: "Storage limit exceeded" }, { status: 400 });
  }

  const fileId = randomUUID();
  const ext    = name.split(".").pop();
  const s3Key  = `uploads/${user.id}/${fileId}.${ext}`;

  const { error: insertError } = await supabase.from("files").insert({
    id:               fileId,
    name,
    mime_type:        mimeType,
    size,
    s3_key:           s3Key,
    s3_bucket:        BUCKET,
    owner_id:         user.id,
    parent_folder_id: parentFolderId ?? null,
    upload_status:    "pending",
  });

  if (insertError) {
    console.error("[presign] insert error:", insertError);
    return Response.json({ error: "Failed to create file record" }, { status: 500 });
  }

  const command = new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         s3Key,
    ContentType: mimeType,
  });

  const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  return Response.json({ presignedUrl, fileId, s3Key, originalFileId });
}