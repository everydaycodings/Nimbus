import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { s3, BUCKET } from "@/lib/s3"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import archiver from "archiver"
import { PassThrough } from "stream"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// 🔥 recursive folder fetch
async function getAllFiles(folderId: string, path = "") {
  const { data: files } = await supabase
    .from("files")
    .select("name, s3_key")
    .eq("parent_folder_id", folderId)
    .eq("upload_status", "complete")
    .eq("is_trashed", false)

  const { data: folders } = await supabase
    .from("folders")
    .select("id, name")
    .eq("parent_folder_id", folderId)
    .eq("is_trashed", false)

  let result: { name: string; s3_key: string; path: string }[] = []

  for (const file of files || []) {
    result.push({
      name: file.name,
      s3_key: file.s3_key,
      path: `${path}${file.name}`,
    })
  }

  for (const folder of folders || []) {
    const nested = await getAllFiles(folder.id, `${path}${folder.name}/`)
    result.push(...nested)
  }

  return result
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")
  if (!token) return new Response("Missing token", { status: 400 })

  const { data: link } = await supabase
    .from("share_links")
    .select("resource_id, resource_type")
    .eq("token", token)
    .maybeSingle()

  if (!link) {
    return new Response("Link not found", { status: 404 })
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
    // 🔥 get folder name
    const { data: folder } = await supabase
      .from("folders")
      .select("name")
      .eq("id", link.resource_id)
      .maybeSingle()

    const folderName = folder?.name ?? "folder"

    // 🔥 timestamp (clean format)
    const now = new Date()
    const timestamp = now
      .toISOString()
      .replace(/[:.]/g, "-") // safe for filenames
      .slice(0, 19) // yyyy-mm-ddThh-mm-ss

    const zipName = `${folderName}-${timestamp}.zip`

    const allFiles = await getAllFiles(link.resource_id)

    const stream = new PassThrough()
    const archive = archiver("zip", { zlib: { level: 9 } })

    archive.pipe(stream)

    for (const file of allFiles) {
      const s3Object = await s3.send(
        new GetObjectCommand({
          Bucket: BUCKET,
          Key: file.s3_key,
        })
      )

      archive.append(s3Object.Body as any, {
        name: file.path,
      })
    }

    archive.finalize()

    return new Response(stream as any, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName}"`,
      },
    })
  }

  return new Response("Invalid resource", { status: 400 })
}
