import "server-only"

import { and, eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { nodeContent, nodes, nodeTextParts, settings } from "@/lib/db/schema"
import { accessOne } from "@/lib/access"
import { ocrAllows, sourceOf } from "@/lib/extract"
import { previewKind } from "@/lib/file-rules"
import { searchItems, UUID, type Hit } from "@/lib/files"
import type { Me } from "@/lib/session"
import type { FileTextStatus, TextPlace } from "@nimbus/shared/api"

// The search box's dropdown: the best place in each file only.
export async function quickSearch(me: Me, q: string): Promise<Hit[]> {
  if (typeof q !== "string") return []
  return searchItems(me.id, q, 12, { places: 1, picture: "thin" })
}

export async function ocrLangs() {
  const [row] = await db.select({ l: settings.ocrLangs }).from(settings)
  return row?.l ?? "eng"
}

// The file, if I can see it; its current version.
export async function visibleFile(me: Me, id: string) {
  if (!UUID.test(id)) return null
  const a = await accessOne(me.id, id)
  if (!a || a.kind !== "file" || a.trashed) return null
  const [n] = await db
    .select({ v: nodes.currentVersionId, name: nodes.name, mime: nodes.mime, ownerId: nodes.ownerId })
    .from(nodes)
    .where(eq(nodes.id, id))
  return n?.v ? { ...n, v: n.v, role: a.role } : null
}

// Every place the words match in a file, in document order. Undefined: not mine.
export async function fileText(me: Me, id: string, q: string) {
  const f = await visibleFile(me, id)
  if (!f) return undefined
  const text = q.trim().slice(0, 200)
  if (!text) return []
  const rows = await db.execute<{
    kind: TextPlace["kind"]
    page: number | null
    t_ms: number | null
    box: [number, number, number, number] | null
    snippet: string
  }>(sql`
    with q as (select websearch_to_tsquery('simple', ${text}) as tq)
    select p.kind, p.page, p.t_ms, p.box,
      ts_headline('simple', p.body, q.tq,
        'StartSel=' || chr(1) || ', StopSel=' || chr(2) || ', MaxFragments=1, MaxWords=18, MinWords=6') as snippet
    from node_text_parts p cross join q
    where p.node_id = ${id} and p.version_id = ${f.v} and p.tsv @@ q.tq
    order by p.page nulls last, p.t_ms nulls last, (p.box->>1)::float nulls last
    limit 200`)
  return rows.map<TextPlace>((p) => ({
    kind: p.kind,
    ...(p.page !== null && { page: p.page }),
    ...(p.t_ms !== null && { tMs: p.t_ms }),
    ...(p.box && { box: p.box }),
    snippet: p.snippet,
  }))
}

// For Details → Text found.
export async function fileTextStatus(
  me: Me,
  id: string
): Promise<FileTextStatus | undefined> {
  const f = await visibleFile(me, id)
  if (!f) return undefined
  const canReread = f.role === "owner"
  const [c] = await db
    .select({
      body: nodeContent.body,
      failed: nodeContent.ocrFailed,
      at: nodeContent.indexedAt,
    })
    .from(nodeContent)
    .where(and(eq(nodeContent.nodeId, id), eq(nodeContent.versionId, f.v)))
  if (c) {
    const base = { preview: c.body.slice(0, 2000), readAt: c.at.toISOString(), canReread }
    return c.failed
      ? { state: "failed", failed: c.failed, ...base }
      : { state: c.body ? "done" : "none", ...base }
  }
  const kind = previewKind(f.mime, f.name)
  const [s] = await db.select({ mode: settings.ocrMode }).from(settings)
  const plain = sourceOf(kind) !== null && kind !== "image" && kind !== "pdf"
  const state =
    plain || kind === "pdf" || ocrAllows(s.mode, kind)
      ? "waiting"
      : kind === "image" || kind === "video"
        ? "off"
        : "none"
  return { state, preview: "", canReread }
}

// Owner only. Forgets the text so the worker reads the file again. False: not allowed.
export async function reread(me: Me, id: string) {
  const f = await visibleFile(me, id)
  if (!f || f.role !== "owner") return false
  await db.delete(nodeTextParts).where(and(eq(nodeTextParts.nodeId, id), eq(nodeTextParts.source, "ocr")))
  await db.delete(nodeContent).where(eq(nodeContent.nodeId, id))
  return true
}
