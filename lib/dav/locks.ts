// WebDAV write locks, one Redis key per node that expires with the lock (an
// hour at most, so a crashed client's lock doesn't linger). Only requests that
// send the lock's token may change what it covers.
import "server-only"

import { inArray, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { nodes } from "@/lib/db/schema"
import { TEMP } from "@/lib/file-rules"
import { redis } from "@/lib/redis"
import type { Lock } from "@/lib/dav/xml"
import { deleteNodes } from "@/lib/uploads"

const key = (id: string) => `dav:lock:${id}`

export async function getLocks(ids: string[]) {
  const out = new Map<string, Lock>()
  if (!ids.length) return out
  const raw = await redis.mget(ids.map(key))
  raw.forEach((r, i) => r && out.set(ids[i], JSON.parse(r)))
  return out
}

export const setLock = (id: string, l: Lock) =>
  redis.set(key(id), JSON.stringify(l), "EX", l.timeout)

export const dropLock = (id: string) => redis.del(key(id))

export async function ancestors(id: string) {
  const rows = await db.execute<{ id: string }>(sql`
    with recursive up as (
      select id, parent_id from nodes where id = ${id}
      union all
      select n.id, n.parent_id from nodes n join up on n.id = up.parent_id
    )
    select id from up where id <> ${id}`)
  return rows.map((r) => r.id)
}

// ponytail: scans every lock key; fine for hundreds of open locks.
async function lockedInside(id: string) {
  const ids: string[] = []
  for await (const keys of redis.scanStream({ match: "dav:lock:*", count: 500 }))
    for (const k of keys as string[]) ids.push(k.slice("dav:lock:".length))
  if (!ids.length) return []
  const rows = await db.execute<{ id: string }>(sql`
    with recursive down as (
      select id from nodes where id = ${id}
      union all
      select n.id from nodes n join down on n.parent_id = down.id
    )
    select id from down where id in ${ids}`)
  return rows.map((r) => r.id)
}

// The lock that stops a request holding `tokens` from changing `id`, if any:
// on the node itself, a depth-infinity lock on a folder above it, and with
// `deep` (deleting or moving a folder) any lock inside it.
export async function blocking(id: string, tokens: Set<string>, deep = false) {
  const above = await ancestors(id)
  const inside = deep ? await lockedInside(id) : []
  const locks = await getLocks([id, ...above, ...inside])
  for (const [at, l] of locks) {
    if (tokens.has(l.token)) continue
    if (at === id || inside.includes(at) || l.depth === "infinity") return l
  }
  return null
}

// Tokens of the locks on `id` and the folders above it.
export async function heldTokens(id: string | null) {
  if (!id) return new Set<string>()
  const locks = await getLocks([id, ...(await ancestors(id))])
  return new Set([...locks.values()].map((l) => l.token))
}

// Temporary save files a WebDAV client left behind (it crashed, or the mount
// dropped mid-save) go after a day unless still locked, and a Mac's ._name
// file once name itself is gone. Only files WebDAV wrote, so nothing uploaded
// on the web is ever touched.
export async function sweepJunk() {
  const rows = await db.execute<{ id: string }>(sql`
    select id from nodes j
    where kind = 'file' and trashed_at is null and s3_key like 'dav-%'
      and updated_at < now() - interval '1 day'
      and (name ~* ${TEMP} or (name like '.\_%' and not exists (
        select 1 from nodes f where f.owner_id = j.owner_id
          and f.parent_id is not distinct from j.parent_id and f.trashed_at is null
          and lower(f.name) = lower(substr(j.name, 3)))))`)
  const ids = rows.map((r) => r.id)
  const held = await getLocks(ids)
  const gone = ids.filter((id) => !held.has(id))
  if (gone.length) await deleteNodes(inArray(nodes.id, gone))
}
