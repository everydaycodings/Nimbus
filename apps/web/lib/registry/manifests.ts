// Manifests, tags and the referrers API.
import "server-only"

import { createHash } from "node:crypto"

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"

import { auditAs } from "@/lib/audit"
import { db } from "@/lib/db"
import {
  registryManifestRefs,
  registryManifests,
  registryPullsDaily,
  registryRepoBlobs,
  registryTags,
} from "@/lib/db/schema"
import type { registryRepos } from "@/lib/db/schema"

import type { C } from "./http.ts"
import { RegError, errors, json, respond } from "./http.ts"
import { MAX_MANIFEST_BYTES, matchPattern, parseDigest, validTag } from "./rules.ts"
import { paginate } from "./wire.ts"

type Repo = typeof registryRepos.$inferSelect

const DOCKER_MANIFEST = "application/vnd.docker.distribution.manifest.v2+json"
const DOCKER_LIST = "application/vnd.docker.distribution.manifest.list.v2+json"
const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json"
const OCI_INDEX = "application/vnd.oci.image.index.v1+json"
const INDEXES = [DOCKER_LIST, OCI_INDEX]
const KNOWN = [DOCKER_MANIFEST, OCI_MANIFEST, ...INDEXES]
// Image configs aren't an "artifact type"; anything else in config.mediaType is (helm, wasm, …).
const IMAGE_CONFIGS = ["application/vnd.oci.image.config.v1+json", "application/vnd.docker.container.image.v1+json"]

type Desc = { mediaType?: string; digest?: string; size?: number; urls?: string[]; platform?: { os?: string; architecture?: string; variant?: string }; artifactType?: string; annotations?: Record<string, string> }

const hashOf = (algo: "sha256" | "sha512", b: Buffer) => `${algo}:${createHash(algo).update(b).digest("hex")}`

async function readBody(req: Request) {
  const parts: Buffer[] = []
  let n = 0
  if (req.body)
    for await (const p of req.body as unknown as AsyncIterable<Uint8Array>) {
      n += p.byteLength
      if (n > MAX_MANIFEST_BYTES) throw new RegError("MANIFEST_INVALID", "The manifest is too large.", 413)
      parts.push(Buffer.from(p))
    }
  return Buffer.concat(parts)
}

// The live manifest a tag or digest points to.
async function find(repoId: string, ref: string) {
  let digest = ref
  if (!parseDigest(ref)) {
    const [t] = await db
      .select({ digest: registryTags.digest })
      .from(registryTags)
      .where(and(eq(registryTags.repoId, repoId), eq(registryTags.name, ref), isNull(registryTags.deletedAt)))
    if (!t) return null
    digest = t.digest
  }
  const [m] = await db
    .select()
    .from(registryManifests)
    .where(and(eq(registryManifests.repoId, repoId), eq(registryManifests.digest, digest), isNull(registryManifests.deletedAt)))
  return m ?? null
}

const today = () => new Date().toISOString().slice(0, 10)

export async function getManifest(repo: Repo, ref: string, head: boolean) {
  const m = await find(repo.id, ref)
  if (!m) throw errors.manifestUnknown(ref)
  if (!head && !parseDigest(ref)) {
    // ponytail: Accept isn't negotiated; clients always get the stored type.
    await db.update(registryTags).set({ lastPulledAt: new Date() }).where(and(eq(registryTags.repoId, repo.id), eq(registryTags.name, ref), isNull(registryTags.deletedAt)))
    await db
      .insert(registryPullsDaily)
      .values({ repoId: repo.id, tag: ref, day: today(), count: 1 })
      .onConflictDoUpdate({
        target: [registryPullsDaily.repoId, registryPullsDaily.tag, registryPullsDaily.day],
        set: { count: sql`${registryPullsDaily.count} + 1` },
      })
  }
  return respond(200, head ? null : new Uint8Array(m.bytes), {
    "Content-Type": m.mediaType,
    "Content-Length": String(m.size),
    "Docker-Content-Digest": m.digest,
    ETag: `"${m.digest}"`,
  })
}

export async function putManifest(c: C, repo: Repo, name: string, ref: string) {
  const bytes = await readBody(c.req)
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(bytes.toString("utf8"))
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw 0
  } catch {
    throw errors.manifestInvalid("The manifest isn't valid JSON.")
  }
  const header = c.req.headers.get("content-type")?.split(";")[0].trim()
  const mediaType = (doc.mediaType as string | undefined) ?? header
  if (!mediaType || !KNOWN.includes(mediaType)) throw errors.manifestInvalid(`Unsupported manifest media type ${mediaType ?? "(none)"}.`)
  if (header && header !== mediaType && doc.mediaType) throw errors.manifestInvalid("The Content-Type doesn't match the manifest's mediaType.")

  const refDigest = parseDigest(ref)
  if (!refDigest && !validTag(ref)) throw errors.manifestInvalid("Invalid tag.")
  const digest = hashOf(refDigest?.algo ?? "sha256", bytes)
  if (refDigest && digest !== ref) throw errors.digestInvalid()

  const isIndex = INDEXES.includes(mediaType)
  const blobs: string[] = []
  const children: string[] = []
  const platforms: string[] = []
  const config = doc.config as Desc | undefined
  if (isIndex) {
    for (const d of (doc.manifests as Desc[] | undefined) ?? []) {
      if (!d?.digest || !parseDigest(d.digest)) throw errors.manifestInvalid("A manifest descriptor has an invalid digest.")
      children.push(d.digest)
      const p = d.platform
      if (p?.os && p.architecture) platforms.push([p.os, p.architecture, p.variant].filter(Boolean).join("/"))
    }
  } else {
    if (!config?.digest) throw errors.manifestInvalid("The manifest has no config.")
    for (const d of [config, ...(((doc.layers ?? doc.blobs) as Desc[] | undefined) ?? [])]) {
      if (!d?.digest || !parseDigest(d.digest)) throw errors.manifestInvalid("A descriptor has an invalid digest.")
      // Foreign layers are fetched from their own URLs.
      if (!d.urls?.length) blobs.push(d.digest)
    }
  }
  const subject = (doc.subject as Desc | undefined)?.digest ?? null
  if (subject && !parseDigest(subject)) throw errors.manifestInvalid("The subject has an invalid digest.")

  const have = new Set(
    blobs.length
      ? (await db.select({ d: registryRepoBlobs.digest }).from(registryRepoBlobs).where(and(eq(registryRepoBlobs.repoId, repo.id), inArray(registryRepoBlobs.digest, blobs)))).map((r) => r.d)
      : []
  )
  const missing = blobs.find((d) => !have.has(d))
  if (missing) throw new RegError("MANIFEST_BLOB_UNKNOWN", "A blob the manifest refers to is unknown to the registry.", 400, { digest: missing })
  if (children.length) {
    const live = new Set(
      (await db.select({ d: registryManifests.digest }).from(registryManifests).where(and(eq(registryManifests.repoId, repo.id), isNull(registryManifests.deletedAt), inArray(registryManifests.digest, children)))).map((r) => r.d)
    )
    const gone = children.find((d) => !live.has(d))
    if (gone) throw new RegError("MANIFEST_BLOB_UNKNOWN", "A manifest the index refers to is unknown to the registry.", 400, { digest: gone })
  }

  const tag = refDigest ? null : ref
  if (tag && repo.immutablePattern && matchPattern(repo.immutablePattern, tag)) {
    const [t] = await db
      .select({ digest: registryTags.digest })
      .from(registryTags)
      .where(and(eq(registryTags.repoId, repo.id), eq(registryTags.name, tag), isNull(registryTags.deletedAt)))
    if (t && t.digest !== digest) throw errors.denied(`Tag ${tag} is immutable.`)
  }

  const artifactType =
    (doc.artifactType as string | undefined) ?? (config?.mediaType && !IMAGE_CONFIGS.includes(config.mediaType) ? config.mediaType : null)
  const [m] = await db
    .insert(registryManifests)
    .values({
      repoId: repo.id,
      digest,
      mediaType,
      artifactType,
      subject,
      bytes,
      size: bytes.length,
      platforms: isIndex ? platforms : null,
      annotations: (doc.annotations as Record<string, string> | undefined) ?? null,
    })
    .onConflictDoUpdate({ target: [registryManifests.repoId, registryManifests.digest], set: { deletedAt: null } })
    .returning({ id: registryManifests.id })
  const refs = [...blobs.map((d) => ({ kind: "blob" as const, digest: d })), ...children.map((d) => ({ kind: "manifest" as const, digest: d }))]
  if (refs.length)
    await db.insert(registryManifestRefs).values(refs.map((r) => ({ manifestId: m.id, ...r }))).onConflictDoNothing()

  if (tag) {
    const set = { digest, pushedBy: c.actor.userId, pushedAt: new Date(), lastPulledAt: null }
    const moved = await db
      .update(registryTags)
      .set(set)
      .where(and(eq(registryTags.repoId, repo.id), eq(registryTags.name, tag), isNull(registryTags.deletedAt)))
      .returning({ id: registryTags.id })
    if (!moved.length) await db.insert(registryTags).values({ repoId: repo.id, name: tag, ...set })
  }
  await auditAs({ id: c.actor.userId, name: c.who.name }, "registry_push", `${name}:${tag ?? digest}`, { ip: c.who.ip })
  return respond(201, null, {
    Location: `/v2/${name}/manifests/${digest}`,
    "Docker-Content-Digest": digest,
    "Content-Length": "0",
    ...(subject && { "OCI-Subject": subject }),
  })
}

// By tag: just the tag. By digest: the manifest and every tag pointing at it.
export async function deleteManifest(c: C, repo: Repo, name: string, ref: string) {
  const immutable = (t: string) => repo.immutablePattern && matchPattern(repo.immutablePattern, t)
  const now = new Date()
  if (!parseDigest(ref)) {
    if (!validTag(ref)) throw errors.manifestInvalid("Invalid tag.")
    if (immutable(ref)) throw errors.denied(`Tag ${ref} is immutable.`)
    const gone = await db
      .update(registryTags)
      .set({ deletedAt: now })
      .where(and(eq(registryTags.repoId, repo.id), eq(registryTags.name, ref), isNull(registryTags.deletedAt)))
      .returning({ id: registryTags.id })
    if (!gone.length) throw errors.manifestUnknown(ref)
  } else {
    const m = await find(repo.id, ref)
    if (!m) throw errors.manifestUnknown(ref)
    const tags = await db
      .select({ name: registryTags.name })
      .from(registryTags)
      .where(and(eq(registryTags.repoId, repo.id), eq(registryTags.digest, ref), isNull(registryTags.deletedAt)))
    const locked = tags.find((t) => immutable(t.name))
    if (locked) throw errors.denied(`Tag ${locked.name} is immutable.`)
    await db.update(registryTags).set({ deletedAt: now }).where(and(eq(registryTags.repoId, repo.id), eq(registryTags.digest, ref), isNull(registryTags.deletedAt)))
    await db.update(registryManifests).set({ deletedAt: now }).where(eq(registryManifests.id, m.id))
  }
  await auditAs({ id: c.actor.userId, name: c.who.name }, "registry_delete", `${name}:${ref}`, { ip: c.who.ip })
  return respond(202, null, { "Content-Length": "0" })
}

export function page(q: URLSearchParams, all: string[], path: string) {
  const r = paginate(q, all, path)
  if (!r) throw new RegError("PAGINATION_NUMBER_INVALID", "Invalid n.", 400)
  return r
}

export async function listTags(c: C, repo: Repo, name: string, head: boolean) {
  const rows = await db
    .select({ name: registryTags.name })
    .from(registryTags)
    .innerJoin(registryManifests, and(eq(registryManifests.repoId, registryTags.repoId), eq(registryManifests.digest, registryTags.digest), isNull(registryManifests.deletedAt)))
    .where(and(eq(registryTags.repoId, repo.id), isNull(registryTags.deletedAt)))
    .orderBy(asc(registryTags.name))
  // Plain string order, as the spec's "last" compares.
  const all = rows.map((r) => r.name).sort()
  const { items, link } = page(c.q, all, `/v2/${name}/tags/list`)
  return json(200, { name, tags: items }, link ? { Link: link } : {}, head)
}

export async function referrers(c: C, repo: Repo, digest: string, head: boolean) {
  if (!parseDigest(digest)) throw errors.digestInvalid("Invalid digest.")
  const filter = c.q.get("artifactType")
  const rows = await db
    .select()
    .from(registryManifests)
    .where(and(eq(registryManifests.repoId, repo.id), eq(registryManifests.subject, digest), isNull(registryManifests.deletedAt)))
    .orderBy(asc(registryManifests.createdAt))
  const manifests = rows
    .filter((m) => !filter || m.artifactType === filter)
    .map((m) => ({
      mediaType: m.mediaType,
      digest: m.digest,
      size: m.size,
      ...(m.artifactType && { artifactType: m.artifactType }),
      ...(m.annotations && { annotations: m.annotations }),
    }))
  return json(200, { schemaVersion: 2, mediaType: OCI_INDEX, manifests }, {
    "Content-Type": OCI_INDEX,
    ...(filter && { "OCI-Filters-Applied": "artifactType" }),
  }, head)
}
