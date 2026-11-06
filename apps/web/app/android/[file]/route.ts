import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

import { APK_FILE, BUNDLED_DIR } from "@/lib/android-release"

// Public: a bundled APK (the fallback when GitHub isn't reachable).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params
  if (!APK_FILE.test(file)) return new Response("Not found", { status: 404 })
  const full = path.join(BUNDLED_DIR, file)
  const info = await stat(full).catch(() => null)
  if (!info) return new Response("Not found", { status: 404 })
  return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Content-Length": String(info.size),
    },
  })
}
