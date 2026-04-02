import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { s3, BUCKET } from "@/lib/s3"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { createFolderZipStream } from "@/lib/stream-zip"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")
  if (!token) return new Response("Missing token", { status: 400 })

  const { data: link } = await supabase
    .from("share_links")
    .select("resource_id, resource_type, can_download")
    .eq("token", token)
    .maybeSingle()

  if (!link) {
    return new Response("Link not found", { status: 404 })
  }

  if (!link.can_download) {
    return new Response("Download disabled for this link", { status: 403 })
  }

  // ════════════════════════════════════
  // 📄 FILE → direct download
  // ════════════════════════════════════
  if (link.resource_type === "file") {
    const { data: file } = await supabase
      .from("files")
      .select("name, s3_key, mime_type")
      .eq("id", link.resource_id)
      .maybeSingle()

    if (!file) return new Response("File not found", { status: 404 })

    const s3Object = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: file.s3_key,
      })
    )

    return new Response(s3Object.Body as any, {
      headers: {
        "Content-Type": file.mime_type,
        "Content-Disposition": `attachment; filename="${file.name}"`,
      },
    })
  }

  // ════════════════════════════════════
  // 📁 FOLDER → ZIP download
  // ════════════════════════════════════
  if (link.resource_type === "folder") {
    const { data: folder } = await supabase
      .from("folders")
      .select("name")
      .eq("id", link.resource_id)
      .maybeSingle()

    const folderName = folder?.name ?? "folder"

    // 🔥 use the optimized stream utility
    const { stream, fileName } = await createFolderZipStream(link.resource_id, folderName)

    return new Response(stream as any, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-cache",
      },
    })
  }

  return new Response("Invalid resource", { status: 400 })
}
