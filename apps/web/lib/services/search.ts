import "server-only"

import { eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { nodeContent, nodes, settings } from "@/lib/db/schema"
import { accessOne, atLeast } from "@/lib/access"
import { MAX_BODY, type Source } from "@/lib/extract"
import { searchItems, UUID, type Hit } from "@/lib/files"
import type { Me } from "@/lib/session"

const SOURCES = new Set<Source>(["text", "pdf", "docx", "sheet", "pptx", "ocr"])

// The search box's dropdown.
export async function quickSearch(me: Me, q: string): Promise<Hit[]> {
  if (typeof q !== "string") return []
  return searchItems(me.id, q, 12)
}

// Text the browser read from a file's current version. Anyone who can edit the
// file may index it; a stale version is ignored.
export async function saveContent(
  me: Me,
  id: string,
  versionId: string,
  body: string,
  source: Source
) {
  if (
    !UUID.test(id) ||
    !UUID.test(versionId) ||
    typeof body !== "string" ||
    !SOURCES.has(source)
  )
    return
  const a = await accessOne(me.id, id)
  if (!a || a.kind !== "file" || !atLeast(a.role, "editor")) return
  const [node] = await db
    .select({ v: nodes.currentVersionId })
    .from(nodes)
    .where(eq(nodes.id, id))
  if (node?.v !== versionId) return
  const row = { versionId, body: body.slice(0, MAX_BODY), source }
  await db
    .insert(nodeContent)
    .values({ nodeId: id, ...row })
    .onConflictDoUpdate({
      target: nodeContent.nodeId,
      set: { ...row, indexedAt: new Date() },
    })
}

export async function ocrLangs() {
  const [row] = await db.select({ l: settings.ocrLangs }).from(settings)
  return row?.l ?? "eng"
}
