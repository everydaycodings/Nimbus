import { and, eq, or } from "drizzle-orm"

import { db } from "@/lib/db"
import { archivePages, archiveSnapshots } from "@/lib/db/schema"
import { UUID } from "@/lib/file-rules"
import { openableFile } from "@/lib/files"
import { presignGet } from "@/lib/s3"
import { memberOrNull } from "@/lib/session"

// 302 to a presigned URL that shows an archived file in place (the viewer's sandboxed iframe, image and text),
// where /api/files/[id]/download would make the browser save it. Only files the member's own snapshots point at.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await memberOrNull()
  if (!me) return new Response("Sign in first", { status: 401 })
  const { id } = await params
  if (!UUID.test(id)) return new Response("Not found", { status: 404 })
  const [hit] = await db
    .select({ id: archiveSnapshots.id })
    .from(archiveSnapshots)
    .innerJoin(archivePages, eq(archivePages.id, archiveSnapshots.pageId))
    .where(and(eq(archivePages.userId, me.id), or(eq(archiveSnapshots.htmlNodeId, id), eq(archiveSnapshots.pdfNodeId, id), eq(archiveSnapshots.pngNodeId, id), eq(archiveSnapshots.textNodeId, id))))
    .limit(1)
  const file = hit && (await openableFile(me.id, id))
  if (!file) return new Response("Not found", { status: 404 })
  // Markdown is shown as plain text, which every browser renders.
  const type = file.mime === "text/markdown" ? "text/plain; charset=utf-8" : (file.mime ?? undefined)
  return Response.redirect(await presignGet(file.key, file.name, { inline: true, expiresIn: 300, type }), 302)
}
