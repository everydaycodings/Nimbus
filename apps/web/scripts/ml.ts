// Phase 20: the optional nimbus-ml service, driven from the minute sweep
// (scripts/worker.ts → index → mlSweep). Speech to text, what a picture looks
// like (CLIP) and faces, one feature at a time so the service swaps models
// rarely. Camera-backup folders go first; vaults, trash and encrypted files never.
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { AUDIO, IMAGE, TEMP, VIDEO } from "../lib/file-rules.ts"
import { previewImageUrl } from "../lib/image-preview.ts"
import {
  FACE_STRICT,
  clusterFaces,
  faceVerdict,
  ml,
  mlBase,
  modelPlan,
  segLines,
  vecLiteral,
  type MlFeature,
} from "../lib/ml.ts"
import { presignGet } from "../lib/s3.ts"
import { busy, sql } from "./indexer.ts"
import { sampleFrames } from "./video-ocr.ts"

type Row = { id: string; v: string; name: string; mime: string | null; size: string; key: string; owner: string }
type Cfg = {
  url: string
  speech: boolean
  clip: boolean
  faces: boolean
  whisper: string
  clipModel: string
  videoMin: number
}

// What Admin → AI features and Health show, written to Redis by the worker after each sweep.
export type MlStatus = {
  up: boolean
  lastError: string | null
  features: Partial<Record<MlFeature, { backlog: number; failed: number; perMin: number }>>
}
export const mlStatus: MlStatus = { up: false, lastError: null, features: {} }

const done: Record<MlFeature, number[]> = { speech: [], clip: [], faces: [] }
const note = (f: MlFeature, n: number) => {
  const now = Date.now()
  done[f] = [...done[f], ...Array(n).fill(now)].filter((t) => now - t < 30 * 60_000).slice(-200)
}
// Files a minute over the last half hour.
const rate = (f: MlFeature) => (done[f].length < 2 ? 0 : Math.round(((done[f].length - 1) / Math.max(60_000, Date.now() - done[f][0])) * 6e4 * 100) / 100)

const cfg = async () =>
  (
    await sql<Cfg[]>`
      select ml_url as url, ml_speech as speech, ml_clip as clip, ml_faces as faces,
        whisper_model as whisper, clip_model as "clipModel", ocr_video_max_min as "videoMin"
      from settings`
  )[0]

const image = `(n.name ~* '${IMAGE.source.replace("|svg", "")}' or n.mime ~ '^image/') and n.name !~* '\\.svg$'`
const video = `(n.name ~* '${VIDEO.source}' or n.mime ~ '^video/') and n.name !~* '\\.(ts|mts|m2ts)$'`
const audio = `(n.name ~* '${AUDIO.source}' or n.mime ~ '^audio/')`

// Files a feature still has to handle, camera folders first. The OCR sweep's rules:
// current version, not trashed, never a vault; then the admin's allow list.
const pending = (feature: MlFeature, c: Cfg) => {
  const kind =
    feature === "speech"
      ? sql.unsafe(`(${video} or ${audio})`)
      : feature === "clip"
        ? sql.unsafe(`(${image} or ${video})`)
        : sql.unsafe(image)
  const todo =
    feature === "speech"
      ? sql`not exists (select 1 from node_speech sp where sp.node_id = n.id
          and sp.version_id = n.current_version_id and sp.model = ${c.whisper})`
      : feature === "clip"
        ? sql`not (fv.ml_done @> array[${"clip:" + c.clipModel}::text])`
        : sql`not (fv.ml_done @> array['faces']) and coalesce(u.faces_on, s.faces_default)`
  return sql`
    from nodes n
    join file_versions fv on fv.id = n.current_version_id and fv.enc_key is null
    join "user" u on u.id = n.owner_id and u.status = 'active'
    left join nodes p on p.id = n.parent_id
    cross join settings s
    where n.kind = 'file' and n.trashed_at is null and n.vault_id is null
      and n.name !~* ${TEMP} and n.size > 0 and ${kind}
      and (s.ai_access = 'everyone' or u.ai_allowed or u.role in ('owner', 'admin')) and ${todo}`
}

const next = (feature: MlFeature, c: Cfg, limit: number) =>
  sql<Row[]>`
    select n.id, n.current_version_id as v, n.name, n.mime, n.size, n.s3_key as key, n.owner_id as owner
    ${pending(feature, c)}
    order by coalesce(p.system_kind = 'camera', false) desc, n.updated_at desc
    limit ${limit}`

const count = async (feature: MlFeature, c: Cfg) =>
  (await sql<{ n: number }[]>`select count(*)::int as n ${pending(feature, c)}`)[0].n

// A preview-sized JPEG of a photo, or null when it can't be read.
// Storage or network trouble throws, so the sweep logs it and tries again later; only a
// photo that can't be turned into a JPEG (too big, not decodable) gives null and is skipped.
async function jpeg(f: Row) {
  const url = await previewImageUrl({ key: f.key, name: f.name }, 600)
  if (!url) {
    console.log(`ml: skipped ${f.name} (can't be read as a picture)`)
    return null
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`reading the preview of ${f.name} failed: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

const markDone = (versionId: string, prefix: string, mark: string) =>
  sql`update file_versions set ml_done = array_append(
      array(select x from unnest(ml_done) x where x not like ${prefix + "%"}), ${mark})
    where id = ${versionId}`

// The service answered with an error for this file (not: couldn't be reached).
const refused = (e: Error) => e.message.startsWith("The AI service answered")

// ---- Speech ----

async function speech(f: Row, c: Cfg, api: ReturnType<typeof ml>) {
  let t
  try {
    t = await api.transcribe(await presignGet(f.key, f.name, { expiresIn: 12 * 3600 }), c.videoMin * 60, c.whisper)
  } catch (e) {
    if (!refused(e as Error)) throw e
    t = { lang: null, segments: [], failed: (e as Error).message.slice(0, 200) }
  }
  const lines = segLines(t.segments)
  await sql.begin(async (tx) => {
    const [row] = await tx`
      insert into node_speech (node_id, version_id, lang, model, body, no_speech, failed)
      select ${f.id}, ${f.v}, ${t.lang}, ${c.whisper}, ${lines.map((l) => l.body).join("\n").slice(0, 400_000)},
        ${!lines.length}, ${"failed" in t ? t.failed : null}
      where exists (select 1 from nodes where id = ${f.id} and current_version_id = ${f.v})
      on conflict (node_id) do update set
        version_id = excluded.version_id, lang = excluded.lang, model = excluded.model,
        body = excluded.body, no_speech = excluded.no_speech, failed = excluded.failed, indexed_at = now()
      returning node_id`
    if (!row) return
    await tx`delete from node_text_parts where node_id = ${f.id} and source = 'speech'`
    for (let i = 0; i < lines.length; i += 500)
      await tx`insert into node_text_parts ${tx(
        lines.slice(i, i + 500).map((l) => ({
          node_id: f.id, version_id: f.v, kind: "time", source: "speech", t_ms: l.tMs, end_ms: l.endMs, body: l.body,
        }))
      )}`
  })
  console.log(`speech ${f.name} (${lines.length} lines${t.lang ? `, ${t.lang}` : ""})`)
  return 1
}

// ---- Pictures ----

async function saveVectors(f: Row, model: string, rows: { tMs: number | null; vec: number[] }[]) {
  await sql.begin(async (tx) => {
    await tx`delete from node_embeddings where node_id = ${f.id}`
    for (const r of rows)
      await tx`insert into node_embeddings (node_id, version_id, t_ms, model, vec)
        values (${f.id}, ${f.v}, ${r.tMs}, ${model}, ${vecLiteral(r.vec)}::vector)`
    await tx`update file_versions set ml_done = array_append(
        array(select x from unnest(ml_done) x where x not like 'clip:%'), ${"clip:" + model})
      where id = ${f.v}`
  })
}

async function videoFrames(f: Row, c: Cfg, api: ReturnType<typeof ml>) {
  const dir = await mkdtemp(join(tmpdir(), "nimbus-clip-"))
  try {
    // ponytail: at most 720 frames (an hour at 5 s) per video; sample thinner for longer ones.
    const url = await presignGet(f.key, f.name, { expiresIn: 12 * 3600 })
    // The file itself can't be read (missing or broken): marked done so it isn't retried every sweep.
    const frames = await sampleFrames(url, c.videoMin, dir, 720).catch(() => null)
    if (!frames) {
      await markDone(f.v, "clip:", "clip:" + c.clipModel)
      console.log(`clip  ${f.name} (unreadable)`)
      return
    }
    const out: { tMs: number; vec: number[] }[] = []
    for (let i = 0; i < frames.length; i += 16) {
      const batch = frames.slice(i, i + 16)
      const vecs = await api.clipImages(await Promise.all(batch.map((b) => readFile(b.path).then((x) => new Uint8Array(x)))), c.clipModel)
      batch.forEach((b, j) => out.push({ tMs: b.tMs, vec: vecs[j] }))
    }
    await saveVectors(f, c.clipModel, out)
    console.log(`clip  ${f.name} (${out.length} frames)`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function clip(c: Cfg, api: ReturnType<typeof ml>) {
  const rows = await next("clip", c, 16)
  const clips = rows.filter((r) => /^video\//.test(r.mime ?? "") || VIDEO.test(r.name))
  const photos: { f: Row; bytes: Uint8Array }[] = []
  for (const f of rows.filter((r) => !clips.includes(r))) {
    const bytes = await jpeg(f)
    // Can't be read as a picture: marked done with no vectors so it isn't retried.
    if (bytes) photos.push({ f, bytes })
    else await markDone(f.v, "clip:", "clip:" + c.clipModel)
  }
  if (photos.length) {
    const vecs = await api.clipImages(photos.map((p) => p.bytes), c.clipModel)
    for (const [i, p] of photos.entries()) await saveVectors(p.f, c.clipModel, [{ tMs: null, vec: vecs[i] }])
    console.log(`clip  ${photos.length} photos`)
  }
  // Videos: one a sweep, so a long one doesn't hold up the rest.
  if (!photos.length && clips[0]) {
    try {
      await videoFrames(clips[0], c, api)
    } catch (e) {
      if (!refused(e as Error)) throw e
      await markDone(clips[0].v, "clip:", "clip:" + c.clipModel)
    }
    return 1
  }
  return photos.length
}

// ---- Faces ----

async function faces(c: Cfg, api: ReturnType<typeof ml>) {
  const rows = await next("faces", c, 8)
  for (const f of rows) {
    const bytes = await jpeg(f)
    const found = bytes ? await api.faces(bytes).catch((e: Error) => { if (!refused(e)) throw e; return [] }) : []
    await sql.begin(async (tx) => {
      await tx`delete from faces where node_id = ${f.id}`
      for (const d of found) {
        const vec = vecLiteral(d.vec)
        const [nearest] = await tx<{ id: string; d: number }[]>`
          select id, centroid <=> ${vec}::vector as d from people
          where owner_id = ${f.owner} and centroid is not null
            and not exists (select 1 from faces x where x.person_id = people.id and x.node_id = ${f.id})
          order by d limit 1`
        const verdict = faceVerdict(nearest?.d ?? null)
        const [face] = await tx<{ id: string }[]>`
          insert into faces (node_id, version_id, owner_id, person_id, suggest_person_id, box, score, vec)
          values (${f.id}, ${f.v}, ${f.owner}, ${verdict === "join" ? nearest.id : null},
            ${verdict === "suggest" ? nearest.id : null}, ${tx.json(d.box)}, ${d.score}, ${vec}::vector)
          returning id`
        if (verdict === "join")
          await tx`update people set centroid = (select avg(vec) from faces where person_id = ${nearest.id}),
            cover_face_id = coalesce(cover_face_id, ${face.id}) where id = ${nearest.id}`
      }
      await tx`update file_versions set ml_done = array_append(array_remove(ml_done, 'faces'), 'faces') where id = ${f.v}`
    })
    console.log(`faces ${f.name} (${found.length})`)
  }
  return rows.length
}

// The nightly pass: faces still unassigned and close to each other become new,
// unnamed people (3 or more faces). Per member, never across accounts.
// ponytail: one neighbour query per unassigned face; fine to tens of thousands, batch it beyond that.
export async function faceCluster() {
  const owners = await sql<{ owner_id: string }[]>`select distinct owner_id from faces where person_id is null`
  for (const { owner_id } of owners) {
    const rows = await sql<{ id: string; node_id: string }[]>`
      select id, node_id from faces where owner_id = ${owner_id} and person_id is null limit 5000`
    const ids = rows.map((r) => r.id)
    const edges = await sql<{ a: string; b: string }[]>`
      select a.id as a, b.id as b from faces a
      cross join lateral (
        select id, vec <=> a.vec as d from faces
        where owner_id = a.owner_id and person_id is null and id <> a.id
        order by vec <=> a.vec limit 8) b
      where a.id = any(${ids}::uuid[]) and b.d <= ${FACE_STRICT}
      order by b.d`
    const photo = new Map(rows.map((r) => [r.id, r.node_id]))
    for (const group of clusterFaces(ids, edges.map((e) => [e.a, e.b]), undefined, photo)) {
      await sql.begin(async (tx) => {
        const [p] = await tx<{ id: string }[]>`
          insert into people (owner_id, centroid, cover_face_id)
          values (${owner_id}, (select avg(vec) from faces where id = any(${group}::uuid[])),
            (select id from faces where id = any(${group}::uuid[]) order by score desc limit 1))
          returning id`
        await tx`update faces set person_id = ${p.id}, suggest_person_id = null where id = any(${group}::uuid[])`
      })
    }
  }
  console.log(`face clusters checked for ${owners.length} members`)
}

// ---- The sweep ----

const FEATURES: MlFeature[] = ["speech", "clip", "faces"]

export async function mlSweep() {
  const c = await cfg()
  const on = FEATURES.filter((f) => c[f])
  mlStatus.features = {}
  if (!on.length) return
  for (const f of on)
    mlStatus.features[f] = {
      backlog: await count(f, c),
      failed:
        f === "speech"
          ? (await sql<{ n: number }[]>`select count(*)::int as n from node_speech where failed is not null and model = ${c.whisper}`)[0].n
          : 0,
      perMin: rate(f),
    }
  const api = ml(mlBase(c.url))
  let health
  try {
    health = await api.health()
    mlStatus.up = true
  } catch (e) {
    mlStatus.up = false
    mlStatus.lastError = (e as Error).message
    return
  }
  // A chosen model that isn't on disk (its download was refused or failed): fetch it, and
  // leave that feature alone until it's ready.
  const plan = modelPlan(health, on, { speech: c.whisper, clip: c.clipModel, faces: "default" })
  if (plan.pull) {
    console.log(`ml: downloading the ${plan.pull.feature} model ${plan.pull.model}`)
    await api.pull(plan.pull.feature, plan.pull.model).catch((e: Error) => console.error(`ml pull: ${e.message}`))
  }
  // Uploads and video copies come first.
  if (await busy()) return
  const feature = plan.ready.find((f) => mlStatus.features[f]!.backlog > 0)
  if (!feature) return
  try {
    let n = 0
    if (feature === "speech") for (const f of await next("speech", c, 1)) n += await speech(f, c, api)
    else if (feature === "clip") n = await clip(c, api)
    else n = await faces(c, api)
    note(feature, n)
    mlStatus.lastError = null
  } catch (e) {
    const err = e as Error
    console.error(`ml ${feature}: ${err.message}`)
    mlStatus.lastError = `${feature}: ${err.message}`.slice(0, 300)
  }
}
