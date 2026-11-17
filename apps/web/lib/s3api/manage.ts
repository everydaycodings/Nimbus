// What the web pages do with S3 buckets and keys: list, make, revoke, mark a
// folder. The protocol itself lives beside this in lib/s3api.
import "server-only"

import { headers } from "next/headers"
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm"

import { accessOne, accessTo, type Access } from "@/lib/access"
import { audit } from "@/lib/audit"
import { decrypt, encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import {
  fileVersions,
  nodes,
  s3Buckets,
  s3KeyBuckets,
  s3Keys,
  user,
} from "@/lib/db/schema"
import { UUID, getPath } from "@/lib/files"
import { ipFrom } from "@/lib/client-ip"
import { notify } from "@/lib/notify"
import { getSettings } from "@/lib/signup"
import { createFolderAs } from "@/lib/tree-ops"
import { isClash } from "@/lib/uploads"
import type { Who } from "./auth"
import { enqueueBucketEtags, etagOf } from "./etags"
import { entries } from "./list"
import { bucketFor } from "./resolve"
import { S3Error } from "./xml"
import { presignGet } from "./sigv4"
import {
  BUCKETS_FOLDER,
  EXPIRY_DAYS,
  MAX_KEYS_PER_MEMBER,
  bucketNameError,
  REGION,
  endpoint,
  newKeyPair,
} from "./rules"

type Result = { error?: string }

// Why the page can't be used, or "ready". "unset" is a server that never turned S3 on in setup.
export type S3State = "ready" | "unset" | "off" | "disabled"

export async function s3State(userId: string): Promise<S3State> {
  if (!endpoint()) return "unset"
  const [[row], s] = await Promise.all([
    db.select({ off: user.s3Disabled }).from(user).where(eq(user.id, userId)),
    getSettings(),
  ])
  return !s.s3Api ? "off" : row?.off ? "disabled" : "ready"
}

export type BucketRow = {
  id: string
  nodeId: string
  name: string
  quiet: boolean
  // "owner" folders are the member's own; others come through a share.
  role: Access
  owner: string | null
  // My files / path, or the owner's folder name when shared.
  path: string
  bytes: number
  objects: number
  createdAt: string
  // The folder is in the trash or no longer shared with them: the bucket is hidden from clients.
  gone: boolean
}

// Files under a folder (not trashed), their bytes, and with `versions` the bytes of every version of them.
async function folderStats(nodeId: string, versions = false) {
  const [r] = await db.execute<{ bytes: string; objects: string; all_bytes: string }>(sql`
    with recursive d as (
      select id, kind, size from nodes where id = ${nodeId}
      union all
      select n.id, n.kind, n.size from nodes n join d on n.parent_id = d.id
        where n.trashed_at is null
    )
    select coalesce(sum(size) filter (where kind = 'file'), 0)::text as bytes,
      count(*) filter (where kind = 'file')::text as objects,
      ${
        versions
          ? sql`coalesce((select sum(v.size) from file_versions v where v.node_id in (select id from d where kind = 'file')), 0)::text`
          : sql`'0'`
      } as all_bytes from d`)
  return { bytes: Number(r?.bytes ?? 0), objects: Number(r?.objects ?? 0), allBytes: Number(r?.all_bytes ?? 0) }
}

// `only`: just the bucket with that name.
export async function listBuckets(userId: string, only?: string): Promise<BucketRow[]> {
  const rows = await db
    .select({
      id: s3Buckets.id,
      nodeId: s3Buckets.nodeId,
      name: s3Buckets.name,
      quiet: s3Buckets.quiet,
      folder: nodes.name,
      ownerId: nodes.ownerId,
      owner: user.name,
      trashedAt: nodes.trashedAt,
      createdAt: s3Buckets.createdAt,
    })
    .from(s3Buckets)
    .innerJoin(nodes, eq(nodes.id, s3Buckets.nodeId))
    .innerJoin(user, eq(user.id, nodes.ownerId))
    .where(and(eq(s3Buckets.userId, userId), only ? eq(s3Buckets.name, only) : undefined))
    .orderBy(asc(s3Buckets.name))
  const access = await accessTo(
    userId,
    rows.map((r) => r.nodeId)
  )
  return Promise.all(
    rows.map(async (r) => {
      const a = access.get(r.nodeId)
      const mine = r.ownerId === userId
      const stats = a && !r.trashedAt ? await folderStats(r.nodeId) : { bytes: 0, objects: 0 }
      return {
        id: r.id,
        nodeId: r.nodeId,
        name: r.name,
        quiet: r.quiet,
        role: a?.role ?? "viewer",
        owner: mine ? null : r.owner,
        path: mine
          ? ["My files", ...(await getPath(r.nodeId)).map((p) => p.name)].join(" / ")
          : r.folder,
        bytes: stats.bytes,
        objects: stats.objects,
        createdAt: r.createdAt.toISOString(),
        gone: !a || Boolean(r.trashedAt),
      }
    })
  )
}

// One of the member's buckets by name, for its own page, with the size of every version.
export async function bucketDetail(userId: string, name: string) {
  const [b] = await listBuckets(userId, name)
  if (!b) return null
  return { ...b, allBytes: b.gone ? 0 : (await folderStats(b.nodeId, true)).allBytes }
}

export type ObjectRow = {
  key: string
  folder: boolean
  size: number
  etag: string
  at: string
  nodeId: string
  versions: number
}

const PAGE = 100

// One page of a bucket's keys under `prefix` (empty or ending in "/"), folders first as they sort,
// after `cursor` (the last key of the previous page). `next` is that cursor when there is more.
export async function listObjects(
  userId: string,
  bucketId: string,
  prefix: string,
  cursor = ""
): Promise<{ items: ObjectRow[]; next: string | null } | null> {
  if (!UUID.test(bucketId)) return null
  const [row] = await db
    .select({ name: s3Buckets.name, nodeId: s3Buckets.nodeId })
    .from(s3Buckets)
    .where(and(eq(s3Buckets.id, bucketId), eq(s3Buckets.userId, userId)))
  if (!row) return null
  // The member browsing their own bucket: the same walk a key with full access gets.
  const who: Who = { keyId: "", userId, write: false, all: true, bucketIds: new Set(), rps: null }
  let got
  try {
    got = await entries(await bucketFor(who, row.name), prefix, cursor, PAGE + 1, false)
  } catch (e) {
    if (e instanceof S3Error) return null
    throw e
  }
  const more = got.length > PAGE
  const page = got.slice(0, PAGE)
  const files = page.filter((e) => !e.folder).map((e) => e.nodeId)
  const counts = files.length
    ? await db
        .select({ nodeId: fileVersions.nodeId, n: count() })
        .from(fileVersions)
        .where(inArray(fileVersions.nodeId, files))
        .groupBy(fileVersions.nodeId)
    : []
  if (page.some((e) => !e.folder && !e.etag)) await enqueueBucketEtags(row.nodeId)
  return {
    items: page.map((e) => ({
      key: e.key,
      folder: e.folder,
      size: e.size,
      etag: e.folder ? "" : etagOf({ id: e.versionId ?? "", etag: e.etag }),
      at: e.at.toISOString(),
      nodeId: e.nodeId,
      versions: counts.find((c) => c.nodeId === e.nodeId)?.n ?? 0,
    })),
    next: more ? page[page.length - 1].key : null,
  }
}

// A link anyone can open until it runs out, signed with one of the member's own live keys that reaches the bucket.
export async function presign(
  userId: string,
  bucketId: string,
  key: string,
  seconds: number
): Promise<Result & { url?: string }> {
  if (!UUID.test(bucketId) || !key || key.endsWith("/")) return { error: "Pick a file." }
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 604_800) return { error: "Pick how long the link lasts." }
  const base = endpoint()
  const [b] = await db
    .select({ name: s3Buckets.name })
    .from(s3Buckets)
    .where(and(eq(s3Buckets.id, bucketId), eq(s3Buckets.userId, userId)))
  if (!base || !b) return { error: "That bucket is gone. Refresh and try again." }
  const [k] = await db
    .select({ accessKeyId: s3Keys.accessKeyId, secret: s3Keys.secretEnc })
    .from(s3Keys)
    .where(
      and(
        eq(s3Keys.userId, userId),
        sql`(${s3Keys.expiresAt} is null or ${s3Keys.expiresAt} > now())`,
        sql`(${s3Keys.allBuckets} or exists (select 1 from s3_key_buckets kb where kb.key_id = ${s3Keys.id} and kb.bucket_id = ${bucketId}))`
      )
    )
    .orderBy(desc(s3Keys.createdAt))
    .limit(1)
  const secret = k && decrypt(k.secret)
  if (!k || !secret) return { error: "Make an access key to share links." }
  return { url: presignGet({ endpoint: base, bucket: b.name, key, accessKeyId: k.accessKeyId, secret, region: REGION, seconds }) }
}

// The bucket on one folder, for the Details panel.
export async function bucketOf(userId: string, nodeId: string) {
  if (!UUID.test(nodeId)) return null
  const [b] = await db
    .select({ id: s3Buckets.id, name: s3Buckets.name, quiet: s3Buckets.quiet })
    .from(s3Buckets)
    .where(and(eq(s3Buckets.userId, userId), eq(s3Buckets.nodeId, nodeId)))
  return b ?? null
}

// Folders the member can mark: reachable, a folder, not in the trash. Vault
// folders never pass accessOne, so they're out too.
async function markable(userId: string, nodeId: string) {
  if (!UUID.test(nodeId)) return null
  const a = await accessOne(userId, nodeId)
  return a && a.kind === "folder" && !a.trashed ? a : null
}

export async function markBucket(
  userId: string,
  nodeId: string,
  rawName: string,
  quiet: boolean
): Promise<Result & { name?: string }> {
  const name = rawName.trim()
  const bad = bucketNameError(name)
  if (bad) return { error: bad }
  if (!(await markable(userId, nodeId)))
    return { error: "That folder can't be a bucket. Vault folders and the trash are left out." }
  try {
    await db.insert(s3Buckets).values({ userId, nodeId, name, quiet })
  } catch (e) {
    if (!isClash(e)) throw e
    const [same] = await db
      .select({ id: s3Buckets.id })
      .from(s3Buckets)
      .where(and(eq(s3Buckets.userId, userId), eq(s3Buckets.nodeId, nodeId)))
    return {
      error: same
        ? "That folder is already a bucket."
        : "You already have a bucket with that name.",
    }
  }
  await audit("s3_bucket_add", { detail: name })
  await enqueueBucketEtags(nodeId)
  return { name }
}

// A new folder under "S3 buckets" in My files, made as a bucket. The folder
// takes the bucket's name.
export async function createBucketFolder(
  userId: string,
  rawName: string,
  quiet: boolean
): Promise<Result> {
  const name = rawName.trim()
  const bad = bucketNameError(name)
  if (bad) return { error: bad }
  const [taken] = await db
    .select({ id: s3Buckets.id })
    .from(s3Buckets)
    .where(and(eq(s3Buckets.userId, userId), eq(s3Buckets.name, name)))
  if (taken) return { error: "You already have a bucket with that name." }
  const [root] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(
      and(
        eq(nodes.ownerId, userId),
        isNull(nodes.parentId),
        isNull(nodes.trashedAt),
        isNull(nodes.vaultId),
        eq(nodes.kind, "folder"),
        eq(nodes.name, BUCKETS_FOLDER)
      )
    )
  const parent = root?.id ?? (await createFolderAs(userId, null, BUCKETS_FOLDER)).id
  if (!parent) return { error: "Couldn't make the S3 buckets folder. Try again." }
  const made = await createFolderAs(userId, parent, name)
  if (made.error || !made.id)
    return {
      error: made.error?.startsWith("Something with that name")
        ? `A folder named “${name}” is already in S3 buckets. Pick it instead.`
        : (made.error ?? "Couldn't make the folder."),
    }
  return markBucket(userId, made.id, name, quiet)
}

export async function unmarkBucket(userId: string, id: string): Promise<Result> {
  if (!UUID.test(id)) return {}
  const gone = await db
    .delete(s3Buckets)
    .where(and(eq(s3Buckets.id, id), eq(s3Buckets.userId, userId)))
    .returning({ name: s3Buckets.name })
  if (gone[0]) await audit("s3_bucket_remove", { detail: gone[0].name })
  return {}
}

export async function setQuiet(userId: string, id: string, quiet: boolean): Promise<Result> {
  if (!UUID.test(id)) return {}
  await db
    .update(s3Buckets)
    .set({ quiet })
    .where(and(eq(s3Buckets.id, id), eq(s3Buckets.userId, userId)))
  return {}
}

// Rename: apps that use the old name stop working until they're told the new one.
export async function renameBucket(userId: string, id: string, rawName: string): Promise<Result & { name?: string }> {
  if (!UUID.test(id)) return { error: "That bucket is gone." }
  const name = rawName.trim()
  const bad = bucketNameError(name)
  if (bad) return { error: bad }
  const [old] = await db
    .select({ name: s3Buckets.name })
    .from(s3Buckets)
    .where(and(eq(s3Buckets.id, id), eq(s3Buckets.userId, userId)))
  if (!old) return { error: "That bucket is gone." }
  if (old.name === name) return { name }
  try {
    await db.update(s3Buckets).set({ name }).where(and(eq(s3Buckets.id, id), eq(s3Buckets.userId, userId)))
  } catch (e) {
    if (!isClash(e)) throw e
    return { error: "You already have a bucket with that name." }
  }
  await audit("s3_bucket_rename", { detail: `${old.name} → ${name}` })
  return { name }
}

export type KeyRow = {
  id: string
  name: string
  accessKeyId: string
  access: "rw" | "ro"
  allBuckets: boolean
  buckets: string[]
  expiresAt: string | null
  expired: boolean
  createdAt: string
  lastUsedAt: string | null
  lastIp: string | null
  // Admin lists only.
  member?: string
  memberId?: string
}

// `userId` null: everyone's keys, for the admin list.
export async function listKeys(userId: string | null): Promise<KeyRow[]> {
  const rows = await db
    .select({
      k: s3Keys,
      member: user.name,
      email: user.email,
    })
    .from(s3Keys)
    .innerJoin(user, eq(user.id, s3Keys.userId))
    .where(userId ? eq(s3Keys.userId, userId) : undefined)
    .orderBy(desc(s3Keys.createdAt))
  const scoped = rows.filter((r) => !r.k.allBuckets).map((r) => r.k.id)
  const picked = scoped.length
    ? await db
        .select({ keyId: s3KeyBuckets.keyId, name: s3Buckets.name })
        .from(s3KeyBuckets)
        .innerJoin(s3Buckets, eq(s3Buckets.id, s3KeyBuckets.bucketId))
        .where(inArray(s3KeyBuckets.keyId, scoped))
        .orderBy(asc(s3Buckets.name))
    : []
  const now = Date.now()
  return rows.map(({ k, member, email }) => ({
    id: k.id,
    name: k.name,
    accessKeyId: k.accessKeyId,
    access: k.access,
    allBuckets: k.allBuckets,
    buckets: picked.filter((p) => p.keyId === k.id).map((p) => p.name),
    expiresAt: k.expiresAt?.toISOString() ?? null,
    expired: Boolean(k.expiresAt && k.expiresAt.getTime() <= now),
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    lastIp: k.lastIp,
    member: member || email,
    memberId: k.userId,
  }))
}

export type NewKey = {
  name: string
  access: string
  allBuckets: boolean
  bucketIds: string[]
  // "never", 30, 90 or 365 days, or a date as YYYY-MM-DD.
  expiry: string
}

function expiryDate(raw: string): Date | null | undefined {
  if (raw === "never") return null
  if (EXPIRY_DAYS.some((d) => String(d) === raw))
    return new Date(Date.now() + Number(raw) * 86_400_000)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined
  // The end of that day, in the server's time.
  const d = new Date(`${raw}T23:59:59`)
  return Number.isNaN(d.getTime()) || d.getTime() <= Date.now() ? undefined : d
}

export async function createKey(
  userId: string,
  o: NewKey
): Promise<Result & { accessKeyId?: string; secret?: string }> {
  const name = String(o.name ?? "").trim().slice(0, 60)
  if (!name) return { error: "Name the key, like “Backups” or “Laptop – rclone”." }
  if (o.access !== "rw" && o.access !== "ro") return { error: "Pick an access level." }
  const expiresAt = expiryDate(String(o.expiry))
  if (expiresAt === undefined) return { error: "Pick a date in the future, or choose Never." }
  const ids = [...new Set(o.bucketIds ?? [])].filter((i) => UUID.test(i))
  if (!o.allBuckets) {
    if (!ids.length) return { error: "Pick at least one bucket, or choose all buckets." }
    const mine = await db
      .select({ id: s3Buckets.id })
      .from(s3Buckets)
      .where(and(eq(s3Buckets.userId, userId), inArray(s3Buckets.id, ids)))
    if (mine.length !== ids.length) return { error: "One of those buckets is gone. Refresh and try again." }
  }
  const [{ n }] = await db
    .select({ n: count() })
    .from(s3Keys)
    .where(eq(s3Keys.userId, userId))
  if (n >= MAX_KEYS_PER_MEMBER)
    return { error: `You have ${MAX_KEYS_PER_MEMBER} access keys. Revoke one first.` }
  const { accessKeyId, secret } = newKeyPair()
  await db.transaction(async (tx) => {
    const [k] = await tx
      .insert(s3Keys)
      .values({
        userId,
        name,
        accessKeyId,
        secretEnc: encrypt(secret),
        access: o.access as "rw" | "ro",
        allBuckets: o.allBuckets,
        expiresAt,
      })
      .returning({ id: s3Keys.id })
    if (!o.allBuckets)
      await tx.insert(s3KeyBuckets).values(ids.map((bucketId) => ({ keyId: k.id, bucketId })))
  })
  await audit("s3_key_create", { detail: `${name} (${accessKeyId})` })
  await notify(userId, "app_password", {
    data: { name, ip: ipFrom(await headers()) || "", s3: "1" },
  })
  return { accessKeyId, secret }
}

// `userId` set: only that member's key (the member's own page); null: any
// member's key (admins). Returns the key's name for the audit line.
export async function revokeKey(userId: string | null, id: string, byAdmin = false): Promise<Result> {
  if (!UUID.test(id)) return {}
  const gone = await db
    .delete(s3Keys)
    .where(and(eq(s3Keys.id, id), userId ? eq(s3Keys.userId, userId) : undefined))
    .returning({ name: s3Keys.name, accessKeyId: s3Keys.accessKeyId, owner: s3Keys.userId })
  if (gone[0])
    await audit("s3_key_revoke", {
      targetId: byAdmin ? gone[0].owner : undefined,
      detail: `${gone[0].name} (${gone[0].accessKeyId})`,
    })
  return {}
}
