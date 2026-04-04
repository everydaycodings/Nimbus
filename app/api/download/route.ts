// app/api/download/route.ts
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKET } from "@/lib/s3";
import { createFolderZipStream } from "@/lib/stream-zip";
import { getEncodedContentDisposition } from "@/lib/s3-signer";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(req: Request) {
  const supabaseServer = await createSupabaseClient();
  const authUserResponse = await supabaseServer.auth.getUser();
  const authUser = authUserResponse.data.user;
  const userId = authUser?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fileId   = searchParams.get("fileId");
  const folderId = searchParams.get("folderId");
  const inline   = searchParams.get("inline") === "true"; // preview vs download

  if (!fileId && !folderId) {
    return Response.json({ error: "Missing fileId or folderId" }, { status: 400 });
  }

  // ── Get user ─────────────────────────────────────────────────
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .single();

  if (!user) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  // ══════════════════════════════════════════════════════════════
  // 📁 FOLDER SUPPORT (New)
  // ══════════════════════════════════════════════════════════════
  if (folderId) {
    const { data: folder, error } = await supabase
      .from("folders")
      .select("id, name, owner_id")
      .eq("id", folderId)
      .eq("is_trashed", false)
      .single();

    if (error || !folder) {
      return Response.json({ error: "Folder not found" }, { status: 404 });
    }

    // Permission check
    const isOwner = folder.owner_id === user.id;
    if (!isOwner) {
      const { data: permission } = await supabase
        .from("permissions")
        .select("id")
        .eq("resource_id", folderId)
        .eq("resource_type", "folder")
        .eq("user_id", user.id)
        .single();

      if (!permission) {
        return Response.json({ error: "Access denied" }, { status: 403 });
      }
    }

    const downloadId = searchParams.get("downloadId");

    // 🔥 Stream the ZIP
    const { stream, fileName } = await createFolderZipStream(folder.id, folder.name, downloadId || undefined);

    return new Response(stream as any, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": getEncodedContentDisposition(fileName, "attachment"),
        "Cache-Control": "no-cache",
      },
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 📄 FILE (Existing logic)
  // ══════════════════════════════════════════════════════════════
  if (fileId) {
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

    const command = new GetObjectCommand({
      Bucket:                     BUCKET,
      Key:                        file.s3_key,
      ResponseContentDisposition: getEncodedContentDisposition(file.name, inline ? "inline" : "attachment"),
      ResponseContentType: file.mime_type,
      ResponseCacheControl: "public, max-age=31536000, immutable",
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return Response.json({ url: signedUrl, name: file.name, mimeType: file.mime_type });
  }

  return Response.json({ error: "Invalid request" }, { status: 400 });
}