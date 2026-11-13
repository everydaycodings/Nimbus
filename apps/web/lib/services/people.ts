// People in my photos (Phase 20, face grouping). Everything here is the owner's own:
// faces only exist on files an account owns, and every call checks the owner, so a
// shared-in viewer never sees or changes anyone's faces.
import "server-only"

import { and, eq, sql } from "drizzle-orm"
import sharp from "sharp"

import { aiConfig, aiFlags } from "@/lib/ai"
import { db } from "@/lib/db"
import { faces, people, user } from "@/lib/db/schema"
import { UUID, ownMedia, photoItems } from "@/lib/files"
import { previewImageUrl } from "@/lib/image-preview"
import { deleteKeys, getStream, headSize, putObject } from "@/lib/s3"
import type { Me } from "@/lib/session"
import type {
  FileFace,
  PeopleResponse,
  PhotoPerson,
  PersonMemory,
  PersonSuggestion,
} from "@nimbus/shared/api"

type Box = [number, number, number, number]
const ids = (list: string[]) => sql.join(list.map((i) => sql`${i}::uuid`), sql`, `)
const valid = (list: unknown): list is string[] =>
  Array.isArray(list) && list.length > 0 && list.length <= 500 && list.every((i) => typeof i === "string" && UUID.test(i))

// A face's file is one the owner still has: not trashed, not in a vault, still the current version.
const liveFace = sql`exists (select 1 from nodes n where n.id = f.node_id
  and n.current_version_id = f.version_id and n.trashed_at is null and n.vault_id is null)`

const recount = (personId: string) =>
  db.execute(sql`update people set centroid = (select avg(vec) from faces where person_id = ${personId}::uuid)
    where id = ${personId}::uuid`)

// People nobody named and no face is left on.
const tidy = (owner: string) =>
  db.execute(sql`delete from people p where p.owner_id = ${owner} and p.name is null
    and not exists (select 1 from faces where person_id = p.id)`)

async function mine(me: Me, id: string) {
  if (!UUID.test(id)) return null
  const [p] = await db.select().from(people).where(and(eq(people.id, id), eq(people.ownerId, me.id)))
  return p ?? null
}

type Row = { id: string; name: string | null; hidden: boolean; memories: boolean; cover: string | null; photos: string; suggestions: string }
const toPerson = (r: Row): PhotoPerson => ({
  id: r.id,
  name: r.name,
  hidden: r.hidden,
  memories: r.memories,
  photos: Number(r.photos),
  suggestions: Number(r.suggestions),
  coverFaceId: r.cover,
})

const select = (owner: string, where: ReturnType<typeof sql>) => sql`
  select p.id, p.name, p.hidden, p.memories,
    coalesce(p.cover_face_id, (select f.id from faces f where f.person_id = p.id and ${liveFace} order by f.score desc limit 1)) as cover,
    (select count(distinct f.node_id) from faces f where f.person_id = p.id and ${liveFace}) as photos,
    (select count(*) from faces f where f.suggest_person_id = p.id and ${liveFace}) as suggestions
  from people p where p.owner_id = ${owner} and ${where}`

export async function listPeople(me: Me, hidden: boolean): Promise<PeopleResponse> {
  const rows = await db.execute<Row>(sql`
    select * from (${select(me.id, sql`true`)}) x where photos > 0
    order by hidden, name is null, photos desc, id`)
  return {
    people: rows.filter((r) => r.hidden === hidden).map(toPerson),
    hiddenCount: rows.filter((r) => r.hidden).length,
  }
}

async function one(me: Me, id: string) {
  const [r] = await db.execute<Row>(select(me.id, sql`p.id = ${id}::uuid`))
  return r ? toPerson(r) : null
}

// Their photos, like GET /photos. Null: not mine.
export async function personPhotos(me: Me, id: string, limit: number, cursor?: string) {
  const person = (await mine(me, id)) && (await one(me, id))
  if (!person) return null
  const r = await photoItems(
    me.id,
    and(
      ownMedia(me.id),
      sql`exists (select 1 from faces f where f.node_id = "nodes".id and f.version_id = "nodes".current_version_id
        and f.person_id = ${id}::uuid)`
    ),
    limit,
    cursor
  )
  return { ...r, person }
}

export async function updatePerson(me: Me, id: string, input: { name?: string | null; hidden?: boolean; memories?: boolean }) {
  if (!(await mine(me, id))) return { error: "That person isn't available anymore." }
  const name = input.name === undefined ? undefined : (input.name ?? "").trim().slice(0, 80) || null
  await db
    .update(people)
    .set({
      ...(name !== undefined && { name }),
      ...(input.hidden !== undefined && { hidden: input.hidden }),
      ...(input.memories !== undefined && { memories: input.memories }),
    })
    .where(eq(people.id, id))
  return { person: (await one(me, id))! }
}

export async function mergePeople(me: Me, id: string, intoId: string) {
  const [a, b] = [await mine(me, id), await mine(me, intoId)]
  if (!a || !b) return { error: "That person isn't available anymore." }
  if (id === intoId) return { error: "Pick a different person to merge into." }
  await db.execute(sql`update faces set person_id = ${intoId}::uuid where person_id = ${id}::uuid`)
  await db.execute(sql`update faces set suggest_person_id = null where suggest_person_id = ${id}::uuid`)
  if (!b.name && a.name) await db.update(people).set({ name: a.name }).where(eq(people.id, intoId))
  await db.delete(people).where(eq(people.id, id))
  await recount(intoId)
  return { person: (await one(me, intoId))! }
}

// The faces must be this person's, mine. Moves them to `toId`, or a new person when null.
export async function moveFaces(me: Me, id: string, faceIds: unknown, toId: string | null) {
  if (!valid(faceIds)) return { error: "Pick some faces." }
  const to = toId ? await mine(me, toId) : null
  if (!(await mine(me, id)) || (toId && !to)) return { error: "That person isn't available anymore." }
  const own = await db.execute<{ id: string }>(sql`
    select f.id from faces f where f.owner_id = ${me.id} and f.person_id = ${id}::uuid and f.id in (${ids(faceIds)})
    order by f.score desc`)
  if (!own.length) return { error: "Those faces aren't available anymore." }
  let target = toId
  if (!target) {
    const [p] = await db.insert(people).values({ ownerId: me.id, coverFaceId: own[0].id }).returning({ id: people.id })
    target = p.id
  }
  await db.execute(sql`update faces set person_id = ${target}::uuid, suggest_person_id = null
    where id in (${ids(own.map((f) => f.id))})`)
  await recount(target)
  await recount(id)
  await tidy(me.id)
  return { person: (await one(me, target))! }
}

// "Not this person": the faces leave them and never rejoin.
export async function notPerson(me: Me, id: string, faceIds: unknown) {
  if (!valid(faceIds)) return { error: "Pick some faces." }
  if (!(await mine(me, id))) return { error: "That person isn't available anymore." }
  const rows = await db.execute<{ id: string }>(sql`
    update faces set person_id = null, rejected = array_append(rejected, ${id}::uuid)
    where owner_id = ${me.id} and person_id = ${id}::uuid and id in (${ids(faceIds)}) returning id`)
  await recount(id)
  return { removed: rows.length }
}

export async function suggestions(me: Me, id: string): Promise<PersonSuggestion[] | null> {
  if (!(await mine(me, id))) return null
  const rows = await db.execute<{ id: string; node_id: string; box: Box }>(sql`
    select f.id, f.node_id, f.box from faces f
    where f.owner_id = ${me.id} and f.suggest_person_id = ${id}::uuid and ${liveFace} order by f.score desc limit 200`)
  return rows.map((r) => ({ faceId: r.id, nodeId: r.node_id, box: r.box }))
}

export async function answerSuggestion(me: Me, faceId: string, accept: boolean) {
  if (!UUID.test(faceId)) return { error: "That face isn't available anymore." }
  const [f] = await db.select().from(faces).where(and(eq(faces.id, faceId), eq(faces.ownerId, me.id)))
  if (!f?.suggestPersonId) return { error: "That face isn't available anymore." }
  const pid = f.suggestPersonId
  if (accept) {
    await db.update(faces).set({ personId: pid, suggestPersonId: null }).where(eq(faces.id, faceId))
    await recount(pid)
  } else
    await db
      .update(faces)
      .set({ suggestPersonId: null, rejected: sql`array_append(${faces.rejected}, ${pid}::uuid)` })
      .where(eq(faces.id, faceId))
  return { person: (await one(me, pid))! }
}

// Puts a face on an existing person, or on a new one with a name (Details → People).
export async function assignFace(me: Me, faceId: string, input: { personId?: string; name?: string }) {
  if (!UUID.test(faceId)) return { error: "That face isn't available anymore." }
  const [f] = await db.select().from(faces).where(and(eq(faces.id, faceId), eq(faces.ownerId, me.id)))
  if (!f) return { error: "That face isn't available anymore." }
  let target: string
  if (input.personId) {
    if (!(await mine(me, input.personId))) return { error: "That person isn't available anymore." }
    target = input.personId
  } else if (typeof input.name === "string") {
    const [p] = await db
      .insert(people)
      .values({ ownerId: me.id, name: input.name.trim().slice(0, 80) || null, coverFaceId: faceId })
      .returning({ id: people.id })
    target = p.id
  } else return { error: "Pick a person or give a name." }
  await db.update(faces).set({ personId: target, suggestPersonId: null }).where(eq(faces.id, faceId))
  await recount(target)
  if (f.personId && f.personId !== target) {
    await recount(f.personId)
    await tidy(me.id)
  }
  return { person: (await one(me, target))! }
}

// Faces on one of my photos, for Details. Empty on anyone else's.
export async function fileFaces(me: Me, nodeId: string): Promise<FileFace[]> {
  if (!UUID.test(nodeId)) return []
  const rows = await db.execute<{
    id: string
    box: Box
    person_id: string | null
    person_name: string | null
    sug_id: string | null
    sug_name: string | null
  }>(sql`
    select f.id, f.box, f.person_id, p.name as person_name, s.id as sug_id, s.name as sug_name
    from faces f
    join nodes n on n.id = f.node_id and n.current_version_id = f.version_id
    left join people p on p.id = f.person_id
    left join people s on s.id = f.suggest_person_id
    where f.node_id = ${nodeId}::uuid and f.owner_id = ${me.id} and n.owner_id = ${me.id}
      and n.trashed_at is null and n.vault_id is null
    order by (f.box->>0)::float`)
  return rows.map((r) => ({
    id: r.id,
    box: r.box,
    personId: r.person_id,
    personName: r.person_name,
    suggestion: r.sug_id ? { personId: r.sug_id, name: r.sug_name } : null,
  }))
}

// ---- Face crops ----

const cropKey = (faceId: string) => `faces/${faceId}.webp`

// A square webp of the face with some margin, cut from the 1920 preview and kept in S3.
// Null: not mine, or the photo can't be read.
export async function faceCrop(me: Me, faceId: string): Promise<Uint8Array | null> {
  if (!UUID.test(faceId)) return null
  const [r] = await db.execute<{ box: Box; key: string; name: string }>(sql`
    select f.box, n.s3_key as key, n.name from faces f
    join nodes n on n.id = f.node_id
    where f.id = ${faceId}::uuid and f.owner_id = ${me.id} and n.owner_id = ${me.id} and n.vault_id is null`)
  if (!r) return null
  const key = cropKey(faceId)
  if ((await headSize(key)) !== null) return new Uint8Array(await new Response(await getStream(key)).arrayBuffer())
  const url = await previewImageUrl({ key: r.key, name: r.name }, 120)
  if (!url) return null
  const res = await fetch(url)
  if (!res.ok) return null
  const img = sharp(Buffer.from(await res.arrayBuffer()))
  const { width = 0, height = 0 } = await img.metadata()
  const [x, y, w, h] = r.box
  const side = Math.min(Math.max(w * width, h * height) * 1.7, width, height)
  const left = Math.round(Math.min(Math.max(0, (x + w / 2) * width - side / 2), width - side))
  const top = Math.round(Math.min(Math.max(0, (y + h / 2) * height - side / 2), height - side))
  const webp = new Uint8Array(
    await img
      .extract({ left, top, width: Math.round(side), height: Math.round(side) })
      .resize(256, 256)
      .webp({ quality: 80 })
      .toBuffer()
  )
  await putObject(key, webp, "image/webp")
  return webp
}

// The person's cover face; null when they have no photos left.
export async function personCover(me: Me, id: string) {
  const p = (await mine(me, id)) && (await one(me, id))
  return p?.coverFaceId ? faceCrop(me, p.coverFaceId) : null
}

// ---- Face grouping on or off ----

// Off deletes this account's faces and people, and the crops; the sweep then skips its photos.
// On starts the sweep over (the "faces" mark comes off every version).
export async function setFacesOn(me: Me, on: boolean) {
  const s = await aiConfig()
  if (on && !(await aiFlags(me.id, s)).faces) return { error: "Face grouping isn't available on this server." }
  await db.update(user).set({ facesOn: on }).where(eq(user.id, me.id))
  if (!on) {
    const rows = await db.execute<{ id: string }>(sql`select id from faces where owner_id = ${me.id}`)
    await db.delete(faces).where(eq(faces.ownerId, me.id))
    await db.delete(people).where(eq(people.ownerId, me.id))
    for (let i = 0; i < rows.length; i += 1000)
      await deleteKeys(rows.slice(i, i + 1000).map((r) => cropKey(r.id))).catch(() => {})
  }
  await db.execute(sql`update file_versions v set ml_done = array_remove(ml_done, 'faces')
    from nodes n where n.id = v.node_id and n.owner_id = ${me.id}`)
  return { on }
}

// ---- Memories ----

// Up to two "With Priya, 2024" cards: named people with 6 or more photos in a past year,
// skipping years already shown as On this day. Hidden days and photos stay hidden.
export async function personMemories(me: Me, today: string, shownYears: number[]): Promise<PersonMemory[]> {
  if (!(await aiFlags(me.id)).facesOn) return []
  const year = Number(today.slice(0, 4))
  const rows = await db.execute<{ id: string; name: string; y: number }>(sql`
    select p.id, p.name, extract(year from coalesce(v.taken_at, v.created_at) at time zone 'UTC')::int as y
    from people p
    join faces f on f.person_id = p.id
    join nodes n on n.id = f.node_id and n.current_version_id = f.version_id
      and n.trashed_at is null and n.vault_id is null
    join file_versions v on v.id = n.current_version_id
    where p.owner_id = ${me.id} and p.name is not null and not p.hidden and p.memories
      and not exists (select 1 from memory_hides h where h.user_id = ${me.id} and h.node_id = n.id)
    group by p.id, p.name, y
    having count(distinct n.id) >= 6 and extract(year from coalesce(v.taken_at, v.created_at) at time zone 'UTC')::int < ${year}
    order by y desc, count(distinct n.id) desc`)
  const out: PersonMemory[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (out.length >= 2) break
    if (seen.has(r.id) || shownYears.includes(r.y)) continue
    seen.add(r.id)
    const { items } = await photoItems(
      me.id,
      and(
        ownMedia(me.id),
        sql`extract(year from coalesce((select taken_at from file_versions where id = "nodes".current_version_id),
          (select created_at from file_versions where id = "nodes".current_version_id)) at time zone 'UTC') = ${r.y}`,
        sql`exists (select 1 from faces f where f.node_id = "nodes".id and f.version_id = "nodes".current_version_id
          and f.person_id = ${r.id}::uuid)`,
        sql`not exists (select 1 from memory_hides h where h.user_id = ${me.id} and h.node_id = "nodes".id)`
      ),
      60
    )
    if (items.length >= 6) out.push({ personId: r.id, name: r.name, year: r.y, yearsAgo: year - r.y, items })
  }
  return out
}
