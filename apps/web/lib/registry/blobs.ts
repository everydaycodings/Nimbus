// Blobs (layers, configs): read, unlink, and link an existing one into a repo.
import "server-only"

import { and, eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { registryBlobs, registryRepoBlobs, registryRepos, settings } from "@/lib/db/schema"
import { getRange, presignGet } from "@/lib/s3"
import type { registryNamespaces } from "@/lib/db/schema"

import { RegError, errors, respond } from "./http.ts"
import { registrySpaceLeft } from "./quota.ts"

type Ns = typeof registryNamespaces.$inferSelect

// The blob when this repo holds it.
export async function linked(repoId: string, digest: string) {
  const [row] = await db
    .select({ digest: registryBlobs.digest, key: registryBlobs.key, size: registryBlobs.size })
    .from(registryRepoBlobs)
    .innerJoin(registryBlobs, eq(registryBlobs.digest, registryRepoBlobs.digest))
    .where(and(eq(registryRepoBlobs.repoId, repoId), eq(registryRepoBlobs.digest, digest)))
  return row ?? null
}

export async function getBlob(repoId: string, digest: string, range: string | null, head: boolean) {
  const b = await linked(repoId, digest)
  if (!b) throw errors.blobUnknown(digest)
  const base = {
    "Docker-Content-Digest": digest,
    "Content-Type": "application/octet-stream",
    "Accept-Ranges": "bytes",
    ETag: `"${digest}"`,
  }
  if (head) return respond(200, null, { ...base, "Content-Length": String(b.size) })
  const [s] = await db.select({ redirect: settings.registryRedirect }).from(settings)
  if (s?.redirect)
    return respond(307, null, { Location: await presignGet(b.key, digest.replace(":", "-"), { expiresIn: 600, type: "application/octet-stream" }) })
  const m = range && /^bytes=\d*-\d*$/.test(range) && range !== "bytes=-" ? range : undefined
  try {
    const r = await getRange(b.key, m)
    return respond(m ? 206 : 200, r.body, {
      ...base,
      "Content-Length": String(r.length ?? b.size),
      ...(r.contentRange && { "Content-Range": r.contentRange }),
    })
  } catch (e) {
    if ((e as { name?: string }).name === "InvalidRange") throw new RegError("BLOB_UPLOAD_INVALID", "Range not satisfiable.", 416)
    throw e
  }
}

// Only the link goes; the bytes stay until a blob has no repo left (garbage collection, later).
export async function unlinkBlob(repoId: string, digest: string) {
  const gone = await db
    .delete(registryRepoBlobs)
    .where(and(eq(registryRepoBlobs.repoId, repoId), eq(registryRepoBlobs.digest, digest)))
    .returning({ d: registryRepoBlobs.digest })
  if (!gone.length) throw errors.blobUnknown(digest)
}

// Is this digest already counted against the namespace?
export async function inNamespace(namespaceId: string, digest: string) {
  const [r] = await db
    .select({ one: sql<number>`1` })
    .from(registryRepoBlobs)
    .innerJoin(registryRepos, eq(registryRepos.id, registryRepoBlobs.repoId))
    .where(and(eq(registryRepos.namespaceId, namespaceId), eq(registryRepoBlobs.digest, digest)))
    .limit(1)
  return !!r
}

// Throws unless the namespace has room for `size` more bytes (nothing when it already holds the digest).
export async function claimSpace(ns: Ns, digest: string, size: number) {
  if (await inNamespace(ns.id, digest)) return
  const left = await registrySpaceLeft(ns.id)
  if (left !== null && size > left) throw errors.denied("The registry storage quota for this namespace is full.")
}

// Cross-repo mount and dedup: the blob already exists, so just link it. False when it can't.
export async function linkExisting(repoId: string, ns: Ns, digest: string) {
  const [b] = await db.select().from(registryBlobs).where(eq(registryBlobs.digest, digest))
  if (!b) return false
  try {
    await claimSpace(ns, digest, b.size)
  } catch {
    return false
  }
  await db.insert(registryRepoBlobs).values({ repoId, digest }).onConflictDoNothing()
  return true
}
