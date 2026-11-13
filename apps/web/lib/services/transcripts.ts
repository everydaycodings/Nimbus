// What was said in a video or audio file (Phase 20): for Details, downloads and captions.
// Anyone who can open the file can read it; only the owner can ask for it again.
import "server-only"

import { and, asc, eq } from "drizzle-orm"

import { aiFlags } from "@/lib/ai"
import { db } from "@/lib/db"
import { nodeSpeech, nodeTextParts } from "@/lib/db/schema"
import { previewKind } from "@/lib/file-rules"
import { buildSrt, buildTxt, buildVtt, type Line } from "@/lib/ml"
import { visibleFile } from "@/lib/services/search"
import type { Me } from "@/lib/session"
import type { TranscriptResponse } from "@nimbus/shared/api"

// The speech lines of a file's current version, in order.
export async function speechLines(nodeId: string, versionId: string): Promise<Line[]> {
  const rows = await db
    .select({ tMs: nodeTextParts.tMs, endMs: nodeTextParts.endMs, body: nodeTextParts.body })
    .from(nodeTextParts)
    .where(
      and(
        eq(nodeTextParts.nodeId, nodeId),
        eq(nodeTextParts.versionId, versionId),
        eq(nodeTextParts.source, "speech")
      )
    )
    .orderBy(asc(nodeTextParts.tMs))
  return rows.map((r) => ({ tMs: r.tMs ?? 0, endMs: r.endMs, body: r.body }))
}

// "Hindi" for "hi".
export const langName = (code: string | null) => {
  if (!code) return null
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

// Undefined: not a file I can see.
export async function transcript(me: Me, id: string) {
  const f = await visibleFile(me, id)
  if (!f) return undefined
  const [row] = await db
    .select({ lang: nodeSpeech.lang, failed: nodeSpeech.failed, none: nodeSpeech.noSpeech, v: nodeSpeech.versionId })
    .from(nodeSpeech)
    .where(eq(nodeSpeech.nodeId, id))
  const canRedo = f.role === "owner"
  if (row?.v === f.v) {
    const lines = row.failed || row.none ? [] : await speechLines(id, f.v)
    const state = row.failed ? "failed" : row.none ? "none" : "done"
    return { f, res: { state, lang: row.lang, lines: lines.map((l) => ({ tMs: l.tMs, endMs: l.endMs, text: l.body })), canRedo, ...(row.failed && { failed: row.failed }) } satisfies TranscriptResponse }
  }
  const kind = previewKind(f.mime, f.name)
  const on = (kind === "video" || kind === "audio") && (await aiFlags(f.ownerId)).speech
  return { f, res: { state: on ? "waiting" : "off", lang: null, lines: [], canRedo } satisfies TranscriptResponse }
}

export const FORMATS = {
  srt: { build: buildSrt, type: "application/x-subrip" },
  txt: { build: buildTxt, type: "text/plain" },
  vtt: { build: buildVtt, type: "text/vtt" },
} as const

// The transcript as a download, or null when there is none.
export async function transcriptFile(me: Me, id: string, format: keyof typeof FORMATS) {
  const t = await transcript(me, id)
  if (!t || t.res.state !== "done") return null
  const lines = t.res.lines.map((l) => ({ tMs: l.tMs, endMs: l.endMs, body: l.text }))
  return {
    body: FORMATS[format].build(lines),
    type: FORMATS[format].type,
    name: t.f.name.replace(/\.[^.]+$/, "") + "." + format,
  }
}

// Owner only: forget it so the worker transcribes the file again. False: not allowed.
export async function redoTranscript(me: Me, id: string) {
  const f = await visibleFile(me, id)
  if (!f || f.role !== "owner") return false
  await db.delete(nodeTextParts).where(and(eq(nodeTextParts.nodeId, id), eq(nodeTextParts.source, "speech")))
  await db.delete(nodeSpeech).where(eq(nodeSpeech.nodeId, id))
  return true
}
