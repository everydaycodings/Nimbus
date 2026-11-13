// The nimbus-ml service (Phase 20): a small HTTP client and the pure rules around
// it. No `@/` imports and no server-only, so the app, scripts/ml.ts (worker) and
// lib/ml.test.ts (node --test) share it.

export const ML_FEATURES = ["speech", "clip", "faces"] as const
export type MlFeature = (typeof ML_FEATURES)[number]

export type MlHealth = {
  version: string
  /** The heavy model in memory, as [feature, model] (at most one). */
  loaded: [MlFeature, string][]
  /** The last download per feature: state "missing", "downloading", "ready" or "failed". */
  models: Partial<Record<MlFeature, { model: string | null; state: string; progress?: number; error?: string | null }>>
  /** Every model on disk, per feature. */
  ready?: Partial<Record<MlFeature, string[]>>
  rssMb: number
}
export type Seg = { start: number; end: number; text: string }
export type Transcript = { lang: string | null; noSpeech?: boolean; segments: Seg[] }
export type DetectedFace = { box: [number, number, number, number]; score: number; vec: number[] }

// ML_URL wins over the admin's saved URL; empty means not set up.
export const mlBase = (saved?: string | null) =>
  (process.env.ML_URL || saved || "").trim().replace(/\/+$/, "")

async function call<T>(base: string, path: string, init: RequestInit = {}, ms = 30_000): Promise<T> {
  if (!base) throw new Error("The AI service isn't set up.")
  const headers = new Headers(init.headers)
  if (process.env.ML_TOKEN) headers.set("Authorization", `Bearer ${process.env.ML_TOKEN}`)
  const res = await fetch(base + path, { ...init, headers, signal: AbortSignal.timeout(ms) })
  if (!res.ok) throw new Error(`The AI service answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as T
}
const json = (body: object): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

// Which enabled features have their chosen model on disk, and which model to download next:
// the first one missing, unless a download is already running (the service takes one at a time).
// A service without `ready` (older) is trusted to have them.
export function modelPlan(h: MlHealth, on: MlFeature[], chosen: Record<MlFeature, string>) {
  const has = (f: MlFeature) => !h.ready || Boolean(h.ready[f]?.includes(chosen[f]))
  const busy = Object.values(h.models).some((m) => m?.state === "downloading")
  const missing = on.find((f) => !has(f))
  return { ready: on.filter(has), pull: busy || !missing ? null : { feature: missing, model: chosen[missing] } }
}

export const ml = (base: string) => ({
  health: () => call<MlHealth>(base, "/health", {}, 8_000),
  pull: (feature: MlFeature, model: string) =>
    call<unknown>(base, "/models/pull", json({ feature, model }), 15_000),
  // `url`: a presigned URL the service reads the audio from.
  transcribe: (url: string, maxSec: number, model: string) =>
    call<Transcript>(base, "/transcribe", json({ url, maxSec, model }), 3 * 3600_000),
  async clipImages(files: Uint8Array[], model: string) {
    const form = new FormData()
    for (const [i, f] of files.entries()) form.append("files", new Blob([f as BlobPart], { type: "image/jpeg" }), `${i}.jpg`)
    form.append("model", model)
    return (await call<{ vectors: number[][] }>(base, "/clip/images", { method: "POST", body: form }, 10 * 60_000)).vectors
  },
  async clipText(q: string, model: string) {
    return (await call<{ vector: number[] }>(base, "/clip/text", json({ q, model }), 8_000)).vector
  },
  async faces(file: Uint8Array) {
    const form = new FormData()
    form.append("file", new Blob([file as BlobPart], { type: "image/jpeg" }), "photo.jpg")
    return (await call<{ faces: DetectedFace[] }>(base, "/faces", { method: "POST", body: form }, 5 * 60_000)).faces
  },
})

// pgvector's text form of a vector.
export const vecLiteral = (v: number[]) => `[${v.join(",")}]`

// ---- Matching rules ----

// Cosine distances (1 - similarity). SFace calls two faces the same person at
// similarity 0.363; joining automatically needs more than that, a suggestion less.
export const FACE_STRICT = 0.45
export const FACE_LOOSE = 0.6
// Faces needed before the nightly pass makes a new, unnamed person.
export const CLUSTER_MIN = 3
// Lowest CLIP cosine similarity that counts as a match, per model (measured on real photos):
// ViT-B/32 matches 0.28–0.31, unrelated queries up to 0.26; multilingual matches 0.20–0.26
// (English, French, Hindi), unrelated up to 0.175.
export const CLIP_MIN_SIM: Record<string, number> = { vitb32: 0.26, multilingual: 0.19 }
export const CLIP_NEAR_BEST = 0.04

export const faceVerdict = (dist: number | null): "join" | "suggest" | "none" =>
  dist === null || dist > FACE_LOOSE ? "none" : dist <= FACE_STRICT ? "join" : "suggest"

// Connected components of `edges` (pairs of ids) over `ids`; only groups of
// `min` or more. Union-find, so a chain A-B-C joins all three.
// Edges go closest first. `photo` maps a face to its file: one person is never twice in the same photo,
// which stops chains of look-alikes from merging different people.
export function clusterFaces(ids: string[], edges: [string, string][], min = CLUSTER_MIN, photo?: Map<string, string>) {
  const parent = new Map(ids.map((i) => [i, i]))
  const photos = new Map(ids.map((i) => [i, new Set(photo?.has(i) ? [photo.get(i)!] : [])]))
  const root = (i: string): string => {
    let r = i
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(i, r)
    return r
  }
  for (const [a, b] of edges) {
    if (!parent.has(a) || !parent.has(b)) continue
    const [ra, rb] = [root(a), root(b)]
    if (ra === rb || [...photos.get(ra)!].some((p) => photos.get(rb)!.has(p))) continue
    parent.set(ra, rb)
    for (const p of photos.get(ra)!) photos.get(rb)!.add(p)
  }
  const groups = new Map<string, string[]>()
  for (const i of ids) groups.set(root(i), [...(groups.get(root(i)) ?? []), i])
  return [...groups.values()].filter((g) => g.length >= min)
}

// Text matches first, then people, then pictures; each file once, at its best rank.
export function mixHits<T extends { id: string }>(
  text: T[],
  person: T[],
  picture: T[],
  limit: number
): (T & { match?: "person" | "picture" })[] {
  const seen = new Set<string>()
  const out: (T & { match?: "person" | "picture" })[] = []
  const add = (list: T[], match?: "person" | "picture") => {
    for (const h of list)
      if (!seen.has(h.id) && out.length < limit) {
        seen.add(h.id)
        out.push(match ? { ...h, match } : h)
      }
  }
  add(text)
  add(person, "person")
  add(picture, "picture")
  return out
}

// ---- Transcripts ----

export type Line = { tMs: number; endMs: number | null; body: string }

const pad = (n: number, w = 2) => String(n).padStart(w, "0")
function stamp(ms: number, sep: "." | ",") {
  const t = Math.max(0, Math.round(ms))
  return `${pad(Math.floor(t / 3600000))}:${pad(Math.floor(t / 60000) % 60)}:${pad(Math.floor(t / 1000) % 60)}${sep}${pad(t % 1000, 3)}`
}
// A line without an end lasts until the next one, or 4 s.
const endOf = (l: Line, next?: Line) => l.endMs ?? next?.tMs ?? l.tMs + 4000

export const buildVtt = (lines: Line[]) =>
  "WEBVTT\n\n" +
  lines.map((l, i) => `${stamp(l.tMs, ".")} --> ${stamp(endOf(l, lines[i + 1]), ".")}\n${l.body}\n`).join("\n")

export const buildSrt = (lines: Line[]) =>
  lines.map((l, i) => `${i + 1}\n${stamp(l.tMs, ",")} --> ${stamp(endOf(l, lines[i + 1]), ",")}\n${l.body}\n`).join("\n")

export const buildTxt = (lines: Line[]) => lines.map((l) => l.body).join("\n") + "\n"

export const segLines = (segs: Seg[]): Line[] =>
  segs
    .map((s) => ({ tMs: Math.round(s.start * 1000), endMs: Math.round(s.end * 1000), body: s.text.trim() }))
    .filter((l) => l.body)
