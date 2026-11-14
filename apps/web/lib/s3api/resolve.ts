// Which folder a bucket name means, and which node an object key means.
// A bucket is a folder; "a/b/c.txt" is folder a, folder b, file c.txt.
import "server-only"

import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { accessOne, atLeast, type Access } from "@/lib/access"
import { db } from "@/lib/db"
import { fileVersions, nodes, s3Buckets } from "@/lib/db/schema"

import type { Who } from "./auth.ts"
import { S3Error } from "./xml.ts"

export type Bucket = {
  id: string
  name: string
  nodeId: string
  // Whose storage the files live in: the folder's owner, who may not be me.
  ownerId: string
  role: Access
  quiet: boolean
  // This key may change things here: a read-write key and at least an editor.
  canWrite: boolean
}

const live = and(isNull(nodes.trashedAt), isNull(nodes.vaultId))

const noBucket = () => new S3Error("NoSuchBucket", "The specified bucket does not exist.", 404)

export function mayReach(who: Who, bucketId: string) {
  return who.all || who.bucketIds.has(bucketId)
}

// The bucket `name` if this key can reach it, else a NoSuchBucket or AccessDenied error.
export async function bucketFor(who: Who, name: string): Promise<Bucket> {
  const [b] = await db
    .select({ id: s3Buckets.id, name: s3Buckets.name, nodeId: s3Buckets.nodeId, quiet: s3Buckets.quiet })
    .from(s3Buckets)
    .where(and(eq(s3Buckets.userId, who.userId), eq(s3Buckets.name, name)))
  if (!b) throw noBucket()
  if (!mayReach(who, b.id)) throw new S3Error("AccessDenied", "This access key can't use that bucket.")
  const a = await accessOne(who.userId, b.nodeId)
  if (!a || a.kind !== "folder" || a.trashed) throw noBucket()
  return { ...b, ownerId: a.ownerId, role: a.role, canWrite: who.write && atLeast(a.role, "editor") }
}

export function mustWrite(b: Bucket) {
  if (!b.canWrite) throw new S3Error("AccessDenied", "This access key can't change that bucket.")
}

// Bucket-name resolution for ListBuckets: only ones the key reaches, still live and accessible.
export async function reachable(who: Who) {
  const rows = await db
    .select({ id: s3Buckets.id, name: s3Buckets.name, nodeId: s3Buckets.nodeId, createdAt: s3Buckets.createdAt })
    .from(s3Buckets)
    .innerJoin(nodes, eq(nodes.id, s3Buckets.nodeId))
    .where(and(eq(s3Buckets.userId, who.userId), live, who.all ? undefined : inArray(s3Buckets.id, [...who.bucketIds, "00000000-0000-0000-0000-000000000000"])))
    .orderBy(s3Buckets.name)
  const out = []
  for (const r of rows) {
    const a = await accessOne(who.userId, r.nodeId)
    if (a && !a.trashed) out.push(r)
  }
  return out
}

// An object key as folder names plus a file name. Keys Nimbus can't hold as a
// path (empty parts, ".", "..", backslashes, over-long names) are an error.
export function splitKey(key: string) {
  const dir = key.endsWith("/")
  const parts = (dir ? key.slice(0, -1) : key).split("/")
  if (!key || Buffer.byteLength(key) > 1024) throw new S3Error("KeyTooLongError", "Your key is too long.", 400)
  for (const p of parts)
    if (!p || p === "." || p === ".." || /[\\\0]/.test(p) || p.length > 255)
      throw new S3Error("InvalidArgument", "Keys can't have empty, \".\" or \"..\" parts, backslashes, or parts over 255 characters.", 400)
  return { dir, parts }
}

export type Found = {
  id: string
  name: string
  kind: "file" | "folder"
  size: number
  mime: string | null
  s3Key: string | null
  currentVersionId: string | null
  updatedAt: Date
  parentId: string | null
}

const cols = {
  id: nodes.id,
  name: nodes.name,
  kind: nodes.kind,
  size: nodes.size,
  mime: nodes.mime,
  s3Key: nodes.s3Key,
  currentVersionId: nodes.currentVersionId,
  updatedAt: nodes.updatedAt,
  parentId: nodes.parentId,
}

export async function childOf(b: Bucket, parentId: string, name: string) {
  const [row] = await db
    .select(cols)
    .from(nodes)
    .where(
      and(eq(nodes.ownerId, b.ownerId), eq(nodes.parentId, parentId), sql`lower(${nodes.name}) = lower(${name})`, live)
    )
  return row as Found | undefined
}

// Follows folder names down from the bucket. `folder` is the deepest one found
// (the bucket itself for a key with no slash), `missing` how many are absent.
export async function walk(b: Bucket, names: string[]) {
  let folder: string = b.nodeId
  for (const [i, n] of names.entries()) {
    const c = await childOf(b, folder, n)
    if (!c) return { folder, missing: names.length - i, blocked: false }
    if (c.kind !== "folder") return { folder, missing: names.length - i, blocked: true }
    folder = c.id
  }
  return { folder, missing: 0, blocked: false }
}

// The object a key means: a file, or with a trailing slash a folder.
export async function findObject(b: Bucket, key: string) {
  const { dir, parts } = splitKey(key)
  const { folder, missing } = await walk(b, parts.slice(0, -1))
  if (missing) return { node: undefined, folder, dir, parts }
  const name = parts.at(-1)!
  const node = await childOf(b, folder, name)
  return { node: dir ? (node?.kind === "folder" ? node : undefined) : node?.kind === "file" ? node : undefined, folder, dir, parts, any: node }
}

export async function versionOf(id: string | null) {
  if (!id) return undefined
  const [v] = await db
    .select({
      id: fileVersions.id,
      s3Key: fileVersions.s3Key,
      size: fileVersions.size,
      mime: fileVersions.mime,
      etag: fileVersions.etag,
      meta: fileVersions.meta,
      createdAt: fileVersions.createdAt,
    })
    .from(fileVersions)
    .where(eq(fileVersions.id, id))
  return v
}
