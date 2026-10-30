// What a WebDAV path points at. The mount shows my files at the root plus a
// "Shared with me" folder holding one folder per person who shared something,
// and inside that the things they shared:
//   /Report.pdf
//   /Shared with me/Alice Ng/Photos/beach.jpg
import "server-only"

import { and, eq, gt, isNull, or, sql } from "drizzle-orm"

import { accessOne, type Access } from "@/lib/access"
import { db } from "@/lib/db"
import { nodes, shares, user } from "@/lib/db/schema"

export const PREFIX = "/dav/"
export const SHARED = "Shared with me"
// Used instead when my root already has a real "Shared with me".
const SHARED_ALT = "Shared with me (Nimbus)"

const cols = {
  id: nodes.id,
  ownerId: nodes.ownerId,
  parentId: nodes.parentId,
  kind: nodes.kind,
  name: nodes.name,
  size: nodes.size,
  mime: nodes.mime,
  s3Key: nodes.s3Key,
  currentVersionId: nodes.currentVersionId,
  createdAt: nodes.createdAt,
  updatedAt: nodes.updatedAt,
}

export type Row = {
  id: string
  ownerId: string
  parentId: string | null
  kind: "file" | "folder"
  name: string
  size: number
  mime: string | null
  s3Key: string | null
  currentVersionId: string | null
  createdAt: Date
  updatedAt: Date
}

export type Place =
  | { kind: "root" }
  | { kind: "shared" }
  | { kind: "owner"; ownerId: string }
  | { kind: "node"; node: Row; role: Access }

// A child as it appears in a listing: the name the mount shows and its place.
export type Child = { name: string; place: Place }

const live = and(isNull(nodes.trashedAt), isNull(nodes.vaultId))

export async function children(
  ownerId: string,
  parentId: string | null
): Promise<Row[]> {
  return db
    .select(cols)
    .from(nodes)
    .where(
      and(
        eq(nodes.ownerId, ownerId),
        parentId ? eq(nodes.parentId, parentId) : isNull(nodes.parentId),
        live
      )
    )
    .orderBy(sql`lower(${nodes.name})`)
}

async function child(ownerId: string, parentId: string | null, name: string) {
  const [row] = await db
    .select(cols)
    .from(nodes)
    .where(
      and(
        eq(nodes.ownerId, ownerId),
        parentId ? eq(nodes.parentId, parentId) : isNull(nodes.parentId),
        sql`lower(${nodes.name}) = lower(${name})`,
        live
      )
    )
  return row as Row | undefined
}

const safe = (s: string) => s.replace(/[/\\\0]/g, "-").trim() || "Someone"

// Everything shared with me, grouped by owner. Owners with the same display
// name get their email added; two shared items with one name get " (2)".
async function sharedWithMe(me: string) {
  const rows = await db
    .select({ ...cols, ownerName: user.name, ownerEmail: user.email })
    .from(shares)
    .innerJoin(nodes, eq(nodes.id, shares.nodeId))
    .innerJoin(user, eq(user.id, nodes.ownerId))
    .where(
      and(
        eq(shares.granteeId, me),
        live,
        or(isNull(shares.expiresAt), gt(shares.expiresAt, sql`now()`))
      )
    )
    .orderBy(shares.createdAt)
  const nameCount = new Map<string, Set<string>>()
  for (const r of rows) {
    const k = safe(r.ownerName).toLowerCase()
    nameCount.set(k, (nameCount.get(k) ?? new Set()).add(r.ownerId))
  }
  const owners = new Map<string, { label: string; items: Child[] }>()
  for (const { ownerName, ownerEmail, ...node } of rows) {
    let o = owners.get(node.ownerId)
    if (!o) {
      const n = safe(ownerName)
      const label =
        nameCount.get(n.toLowerCase())!.size > 1 ? `${n} (${safe(ownerEmail)})` : n
      o = { label, items: [] }
      owners.set(node.ownerId, o)
    }
    let name = node.name
    const taken = new Set(o.items.map((c) => c.name.toLowerCase()))
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${node.name} (${i})`
    o.items.push({ name, place: { kind: "node", node, role: "viewer" } })
  }
  return owners
}

// The role comes from the shares, never from where the path went through.
async function withRole(me: string, node: Row): Promise<Place | null> {
  if (node.ownerId === me) return { kind: "node", node, role: "owner" }
  const a = await accessOne(me, node.id)
  return a ? { kind: "node", node, role: a.role } : null
}

export async function list(me: string, place: Place): Promise<Child[]> {
  if (place.kind === "root") {
    const mine = await children(me, null)
    const real = mine.some((r) => r.name.toLowerCase() === SHARED.toLowerCase())
    return [
      ...mine.map((node) => ({ name: node.name, place: { kind: "node", node, role: "owner" } as Place })),
      { name: real ? SHARED_ALT : SHARED, place: { kind: "shared" } },
    ]
  }
  if (place.kind === "shared")
    return [...(await sharedWithMe(me))].map(([ownerId, o]) => ({
      name: o.label,
      place: { kind: "owner", ownerId },
    }))
  if (place.kind === "owner") {
    const items = (await sharedWithMe(me)).get(place.ownerId)?.items ?? []
    const out: Child[] = []
    for (const c of items) {
      const p = await withRole(me, (c.place as { node: Row }).node)
      if (p) out.push({ name: c.name, place: p })
    }
    return out
  }
  if (place.node.kind !== "folder") return []
  return (await children(place.node.ownerId, place.node.id)).map((node) => ({
    name: node.name,
    place: { kind: "node", node, role: place.role },
  }))
}

// Walks `names` from the root. `place` is null when the last name doesn't
// exist; `parent` is null when the folder it would go in doesn't either.
export async function resolve(me: string, names: string[]) {
  let place: Place | null = { kind: "root" }
  let parent: Place | null = null
  for (const name of names) {
    parent = place
    place = parent ? await step(me, parent, name) : null
  }
  // Deeper shares can give more than the one the path came through.
  if (place?.kind === "node" && place.node.ownerId !== me)
    place = await withRole(me, place.node)
  if (parent?.kind === "node" && parent.node.ownerId !== me)
    parent = await withRole(me, parent.node)
  return { place, parent }
}

async function step(me: string, at: Place, name: string): Promise<Place | null> {
  const lower = name.toLowerCase()
  if (at.kind === "root") {
    const real = await child(me, null, name)
    if (real) return { kind: "node", node: real, role: "owner" }
    if (lower === SHARED.toLowerCase() || lower === SHARED_ALT.toLowerCase())
      return { kind: "shared" }
    return null
  }
  if (at.kind === "shared" || at.kind === "owner") {
    const hit = (await list(me, at)).find((c) => c.name.toLowerCase() === lower)
    return hit?.place ?? null
  }
  if (at.node.kind !== "folder") return null
  const row = await child(at.node.ownerId, at.node.id, name)
  return row ? { kind: "node", node: row, role: at.role } : null
}
