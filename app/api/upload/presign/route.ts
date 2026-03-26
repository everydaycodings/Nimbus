// app/api/upload/presign/route.ts
import { auth } from "@clerk/nextjs/server";
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
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, storage_used, storage_limit")
    .eq("clerk_id", userId)
    .single();

  if (userError || !user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  const { name, mimeType, size, parentFolderId } = await req.json();

  if (!name || !mimeType || !size) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
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

  return Response.json({ presignedUrl, fileId, s3Key });
}