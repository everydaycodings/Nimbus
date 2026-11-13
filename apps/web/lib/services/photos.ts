// Photos beyond the timeline: On this day, what's hidden from it, the Places map and smart groups.
// GPS is the owner's alone: it only comes out of places(), for the viewer's own photos.
import "server-only"

import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm"
import { isSmartGroup } from "@nimbus/shared/smart-groups"
import type {
  MemoriesResponse,
  MemoryHide,
  NewMemoryHide,
  PlacePoint,
} from "@nimbus/shared/api"

import { accessOne } from "@/lib/access"
import { db } from "@/lib/db"
import { fileVersions, memoryHides, nodes } from "@/lib/db/schema"
import { UUID, ownMedia, photoItems, photoWhen } from "@/lib/files"
import { personMemories } from "@/lib/services/people"
import type { Me } from "@/lib/session"

const utcDay = sql`to_char(${photoWhen} at time zone 'UTC', 'MM-DD')`

// ---- On this day ----

export async function memories(me: Me, date?: string): Promise<MemoriesResponse> {
  const today = /^\d{4}-\d\d-\d\d$/.test(date ?? "") && !Number.isNaN(Date.parse(date!))
    ? date!
    : new Date().toISOString().slice(0, 10)
  const year = Number(today.slice(0, 4))
  const { items } = await photoItems(
    me.id,
    and(
      ownMedia(me.id),
      sql`${utcDay} = ${today.slice(5)}`,
      sql`extract(year from ${photoWhen} at time zone 'UTC') < ${year}`,
      sql`not exists (select 1 from memory_hides h where h.user_id = ${me.id}
        and (h.node_id = "nodes".id or h.day = ${utcDay}))`,
      // A hidden folder hides everything inside it.
      sql`not exists (
        with recursive up as (
          select x.id, x.parent_id from nodes x where x.id = "nodes".parent_id
          union all
          select n.id, n.parent_id from nodes n join up on n.id = up.parent_id
        )
        select 1 from up join memory_hides h on h.node_id = up.id
        where h.user_id = ${me.id} and h.kind = 'folder')`
    ),
    500
  )
  const years: MemoriesResponse["years"] = []
  for (const it of items) {
    const y = Number(it.takenAt.slice(0, 4))
    let g = years.find((x) => x.year === y)
    if (!g) years.push((g = { year: y, yearsAgo: year - y, items: [] }))
    g.items.push(it)
  }
  return { date: today, years, people: await personMemories(me, today, years.map((y) => y.year)) }
}

export async function listHides(me: Me): Promise<MemoryHide[]> {
  const rows = await db
    .select({
      id: memoryHides.id,
      kind: memoryHides.kind,
      nodeId: memoryHides.nodeId,
      name: nodes.name,
      day: memoryHides.day,
      createdAt: memoryHides.createdAt,
    })
    .from(memoryHides)
    .leftJoin(nodes, eq(nodes.id, memoryHides.nodeId))
    .where(eq(memoryHides.userId, me.id))
    .orderBy(sql`${memoryHides.createdAt} desc`)
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
}

export async function addHide(
  me: Me,
  input: NewMemoryHide
): Promise<{ error?: string; id?: string }> {
  const { kind } = input
  if (kind === "day") {
    if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(input.day)))
      return { error: "Pick a valid day." }
  } else if (kind === "photo" || kind === "folder") {
    const id = String(input.nodeId)
    const a = UUID.test(id) ? await accessOne(me.id, id) : null
    if (a?.role !== "owner" || a.kind !== (kind === "photo" ? "file" : "folder"))
      return { error: "That item isn't available anymore." }
  } else return { error: "Hide a photo, a day or a folder." }
  const values = {
    userId: me.id,
    kind,
    nodeId: kind === "day" ? null : input.nodeId!,
    day: kind === "day" ? input.day! : null,
  }
  await db.insert(memoryHides).values(values).onConflictDoNothing()
  const [row] = await db
    .select({ id: memoryHides.id })
    .from(memoryHides)
    .where(
      and(
        eq(memoryHides.userId, me.id),
        kind === "day"
          ? eq(memoryHides.day, values.day!)
          : eq(memoryHides.nodeId, values.nodeId!)
      )
    )
  return { id: row.id }
}

export async function removeHide(me: Me, id: string): Promise<{ error?: string }> {
  if (!UUID.test(id)) return { error: "That item isn't available anymore." }
  await db
    .delete(memoryHides)
    .where(and(eq(memoryHides.id, id), eq(memoryHides.userId, me.id)))
  return {}
}

// ---- Places ----

// "west,south,east,north" as numbers, or null.
// ponytail: a box across the antimeridian isn't handled (west > east matches nothing).
export function parseBbox(raw: string | undefined) {
  if (!raw) return null
  const n = raw.split(",").map(Number)
  return n.length === 4 && n.every(Number.isFinite) ? n : null
}

const inBox = (b: number[] | null) =>
  b
    ? and(
        gte(fileVersions.lng, b[0]),
        gte(fileVersions.lat, b[1]),
        lte(fileVersions.lng, b[2]),
        lte(fileVersions.lat, b[3])
      )
    : undefined

// My own photos with a location, for the map. ponytail: capped at 20,000 points, newest first.
export async function places(me: Me, bbox: number[] | null): Promise<PlacePoint[]> {
  const rows = await db
    .select({
      id: nodes.id,
      lat: fileVersions.lat,
      lng: fileVersions.lng,
      takenAt: sql<Date>`coalesce(${fileVersions.takenAt}, ${fileVersions.createdAt})`,
      version: nodes.currentVersionId,
      thumb: fileVersions.thumb,
    })
    .from(nodes)
    .innerJoin(fileVersions, eq(fileVersions.id, nodes.currentVersionId))
    .where(
      and(ownMedia(me.id), isNotNull(fileVersions.lat), isNotNull(fileVersions.lng), inBox(bbox))
    )
    .orderBy(sql`${photoWhen} desc`)
    .limit(20000)
  return rows.map((r) => ({
    ...r,
    lat: r.lat!,
    lng: r.lng!,
    takenAt: new Date(r.takenAt).toISOString(),
  }))
}

// The photos inside a box (a tapped cluster), without their coordinates.
export async function placeItems(me: Me, bbox: number[] | null) {
  const { items, total } = await photoItems(
    me.id,
    and(ownMedia(me.id), isNotNull(fileVersions.lat), inBox(bbox)),
    200
  )
  return { items, total }
}

// ---- Smart groups ----

export async function smart(me: Me, group: string, limit: number, cursor?: string) {
  if (!isSmartGroup(group)) return null
  return photoItems(
    me.id,
    and(ownMedia(me.id), sql`${fileVersions.smart} @> array[${group}]::text[]`),
    limit,
    cursor
  )
}
