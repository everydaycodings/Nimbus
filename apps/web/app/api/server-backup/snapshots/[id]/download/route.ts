import { openDownload, snapshotCtx } from "@/lib/server-backup/restore"
import { memberOrNull } from "@/lib/session"
import { allowed } from "@/lib/server-backup/access"
import { getSettings } from "@/lib/signup"
import { contentDisposition } from "@/lib/upload-rules"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// A file from a snapshot, or (dir=1) a folder as a zip, streamed from the repository.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await memberOrNull()
  const s = await getSettings()
  if (!me || !allowed(s, me.role)) return new Response("Not found", { status: 404 })
  const c = await snapshotCtx(me.id, (await params).id)
  if (!c) return new Response("Not found", { status: 404 })
  const q = new URL(req.url).searchParams
  const dl = openDownload(c, q.get("path") ?? "", q.get("dir") === "1")
  req.signal.addEventListener("abort", dl.close)
  return new Response(dl.stream, { headers: { "Content-Type": dl.zip ? "application/zip" : "application/octet-stream", "Content-Disposition": contentDisposition(dl.name), "Cache-Control": "no-store" } })
}
