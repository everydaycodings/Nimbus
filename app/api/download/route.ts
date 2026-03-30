// app/api/download/route.ts
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "@/lib/s3";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fileId  = searchParams.get("fileId");
  const inline  = searchParams.get("inline") === "true"; // preview vs download

  if (!fileId) {
    return Response.json({ error: "Missing fileId" }, { status: 400 });
  }

  // ── Get user ─────────────────────────────────────────────────
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("clerk_id", userId)
    .single();

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // ── Get file — check ownership OR shared permission ──────────
  const { data: file, error } = await supabase
    .from("files")
    .select("id, name, s3_key, mime_type, owner_id")
    .eq("id", fileId)
    .eq("upload_status", "complete")
    .eq("is_trashed", false)
    .single();

  if (error || !file) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }

  // Must be owner or have permission
  const isOwner = file.owner_id === user.id;
  if (!isOwner) {
    const { data: permission } = await supabase
      .from("permissions")
      .select("id")
      .eq("resource_id", fileId)
      .eq("resource_type", "file")
      .eq("user_id", user.id)
      .single();

    if (!permission) {
      return Response.json({ error: "Access denied" }, { status: 403 });
    }
  }

  // ── Generate signed URL ───────────────────────────────────────
  const command = new GetObjectCommand({
    Bucket:                     BUCKET,
    Key:                        file.s3_key,
    ResponseContentDisposition: inline
      ? `inline; filename="${file.name}"`
      : `attachment; filename="${file.name}"`,
    ResponseContentType: file.mime_type,
    ResponseCacheControl: "public, max-age=31536000, immutable",
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour

  return Response.json({ url: signedUrl, name: file.name, mimeType: file.mime_type });
}