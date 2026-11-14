// Pull-through mirror: mirror/<upstream>/<repo…>. Any signed-in caller can pull, nobody can
// push. Manifests are fetched from the upstream (with its Bearer-token flow) and cached with a
// tag in a repo of the reserved "mirror" namespace (kind org, ref_id "system", never metered);
// blobs are fetched on first pull, streamed to the client while they're stored. Cached tags
// refresh from the upstream after 5 minutes (the cache answers when it's down) and expire after
// the upstream's ttlDays without a pull (expireMirror).
import "server-only"

import { and, eq, isNull, sql } from "drizzle-orm"

import { decrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import {
  registryBlobs,
  registryManifestRefs,
  registryManifests,
  registryNamespaces,
  registryRepoBlobs,
  registryRepos,
  registryTags,
  registryUpstreams,
} from "@/lib/db/schema"

import { resolveRepo } from "./access.ts"
import { getBlob, linked, throttle } from "./blobs.ts"
import { RegError, errors, respond, type C } from "./http.ts"
import {
  DOCKER_LIST,
  DOCKER_MANIFEST,
  IMAGE_CONFIGS,
  INDEXES,
  KNOWN,
  OCI_INDEX,
  OCI_MANIFEST,
  find,
  getManifest,
  hashOf,
  type Desc,
} from "./manifests.ts"
import { MAX_MANIFEST_BYTES, parseDigest, validRepoName } from "./rules.ts"
import { discard, finish, patch, startUpload } from "./uploads.ts"

type Upstream = typeof registryUpstreams.$inferSelect
type Repo = typeof registryRepos.$inferSelect

const REFRESH_MS = 5 * 60_000
const ACCEPT = [OCI_INDEX, DOCKER_LIST, OCI_MANIFEST, DOCKER_MANIFEST].join(", ")

export const isMirror = (name: string) => name.startsWith("mirror/")

// Signed-in only, a token that reaches every repo, and an enabled upstream; the rest is the upstream's path.
async function gate(c: C, name: string) {
  if (!c.actor.userId) throw errors.unauthorized()
  if (c.actor.tokenId && !c.actor.allRepos) throw errors.denied()
  const [, upName, ...rest] = name.split("/")
  if (!upName || !rest.length || !validRepoName(name.slice("mirror/".length))) throw errors.nameInvalid(name)
  const [up] = await db.select().from(registryUpstreams).where(and(eq(registryUpstreams.name, upName), eq(registryUpstreams.enabled, true)))
  if (!up) throw errors.nameUnknown(name)
  const path = rest.join("/")
  // Docker Hub's single-name images live under library/.
  return { up, path: /(^|\.)docker\.io$/.test(new URL(up.url).hostname) && !path.includes("/") ? `library/${path}` : path }
}

const bearers = new Map<string, { token: string; exp: number }>()

// One upstream request, answering a 401 challenge once: Bearer (token service, with the upstream's
// login when set) or Basic.
async function upstream(u: Upstream, path: string, repo: string, o: { accept?: string; method?: string; signal?: AbortSignal } = {}) {
  const url = `${u.url.replace(/\/+$/, "")}/v2/${path}`
  const pw = u.passwordEnc ? decrypt(u.passwordEnc) : null
  const basic = u.username && pw !== null ? `Basic ${Buffer.from(`${u.username}:${pw}`).toString("base64")}` : null
  const send = (auth?: string) =>
    fetch(url, {
      method: o.method ?? "GET",
      headers: { "user-agent": "Nimbus-Registry-Mirror", ...(o.accept && { accept: o.accept }), ...(auth && { authorization: auth }) },
      signal: o.signal ?? AbortSignal.timeout(30_000),
    })
  const key = `${u.id}|${repo}`
  const have = bearers.get(key)
  let res = await send(have && have.exp > Date.now() ? `Bearer ${have.token}` : undefined)
  if (res.status !== 401) return res
  const challenge = res.headers.get("www-authenticate") ?? ""
  await res.body?.cancel()
  if (/^basic/i.test(challenge)) return basic ? send(basic) : res
  const p = Object.fromEntries([...challenge.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
  if (!p.realm) return res
  const t = new URL(p.realm)
  if (p.service) t.searchParams.set("service", p.service)
  t.searchParams.set("scope", p.scope || `repository:${repo}:pull`)
  const tr = await fetch(t, { headers: { "user-agent": "Nimbus-Registry-Mirror", ...(basic && { authorization: basic }) }, signal: AbortSignal.timeout(15_000) })
  if (!tr.ok) throw new RegError("DENIED", "The upstream registry refused the mirror's login.", 403)
  const j = (await tr.json()) as { token?: string; access_token?: string; expires_in?: number }
  const token = j.token ?? j.access_token
  if (!token) throw new RegError("DENIED", "The upstream registry gave no token.", 403)
  bearers.set(key, { token, exp: Date.now() + Math.max(30, (j.expires_in ?? 60) - 10) * 1000 })
  return send(`Bearer ${token}`)
}

// The synthetic repo for mirror/<upstream>/<repo>, made on the first successful fetch.
async function ensureRepo(name: string): Promise<Repo> {
  const found = await resolveRepo(name)
  if (found) return found.repo
  await db.insert(registryNamespaces).values({ name: "mirror", kind: "org", refId: "system" }).onConflictDoNothing()
  const [ns] = await db.select().from(registryNamespaces).where(sql`lower(${registryNamespaces.name}) = 'mirror'`)
  const rest = name.slice("mirror/".length)
  await db.insert(registryRepos).values({ namespaceId: ns.id, name: rest }).onConflictDoNothing()
  const [repo] = await db
    .update(registryRepos)
    .set({ deletedAt: null })
    .where(and(eq(registryRepos.namespaceId, ns.id), eq(registryRepos.name, rest)))
    .returning()
  return repo
}

// Keeps a fetched manifest (and its tag) the way putManifest would, minus the blob checks:
// the layers arrive on the first pull. Index children arrive as clients ask for them.
async function keep(repo: Repo, bytes: Buffer, type: string | null, ref: string) {
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(bytes.toString("utf8"))
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw 0
  } catch {
    throw errors.manifestInvalid("The upstream manifest isn't valid JSON.")
  }
  const mediaType = (doc.mediaType as string | undefined) ?? type?.split(";")[0].trim()
  if (!mediaType || !KNOWN.includes(mediaType)) throw errors.manifestInvalid(`Unsupported upstream manifest type ${mediaType ?? "(none)"}.`)
  const want = parseDigest(ref)
  const digest = hashOf(want?.algo ?? "sha256", bytes)
  if (want && digest !== ref) throw errors.digestInvalid("The upstream sent a manifest that doesn't match its digest.")
  const isIndex = INDEXES.includes(mediaType)
  const config = doc.config as Desc | undefined
  const refs: { kind: "blob" | "manifest"; digest: string }[] = []
  const platforms: string[] = []
  if (isIndex)
    for (const d of (doc.manifests as Desc[] | undefined) ?? []) {
      if (!d?.digest || !parseDigest(d.digest)) continue
      refs.push({ kind: "manifest", digest: d.digest })
      const p = d.platform
      if (p?.os && p.architecture) platforms.push([p.os, p.architecture, p.variant].filter(Boolean).join("/"))
    }
  else
    for (const d of [config, ...(((doc.layers ?? doc.blobs) as Desc[] | undefined) ?? [])])
      if (d?.digest && parseDigest(d.digest) && !d.urls?.length) refs.push({ kind: "blob", digest: d.digest })
  const subject = (doc.subject as Desc | undefined)?.digest ?? null
  const [m] = await db
    .insert(registryManifests)
    .values({
      repoId: repo.id,
      digest,
      mediaType,
      artifactType: (doc.artifactType as string | undefined) ?? (config?.mediaType && !IMAGE_CONFIGS.includes(config.mediaType) ? config.mediaType : null),
      subject: subject && parseDigest(subject) ? subject : null,
      bytes,
      size: bytes.length,
      platforms: isIndex ? platforms : null,
      annotations: (doc.annotations as Record<string, string> | undefined) ?? null,
    })
    .onConflictDoUpdate({ target: [registryManifests.repoId, registryManifests.digest], set: { deletedAt: null } })
    .returning({ id: registryManifests.id })
  if (refs.length) await db.insert(registryManifestRefs).values(refs.map((r) => ({ manifestId: m.id, ...r }))).onConflictDoNothing()
  if (!want) {
    const set = { digest, pushedBy: null, pushedAt: new Date(), lastPulledAt: null }
    await db
      .insert(registryTags)
      .values({ repoId: repo.id, name: ref, ...set })
      .onConflictDoUpdate({ target: [registryTags.repoId, registryTags.name], targetWhere: isNull(registryTags.deletedAt), set })
  }
}

export async function mirrorManifest(c: C, name: string, ref: string, head: boolean) {
  const { up, path } = await gate(c, name)
  const found = await resolveRepo(name)
  const cached = found ? await find(found.repo.id, ref) : null
  let fresh = !!cached
  if (cached && !parseDigest(ref)) {
    const [t] = await db
      .select({ at: registryTags.pushedAt })
      .from(registryTags)
      .where(and(eq(registryTags.repoId, found!.repo.id), eq(registryTags.name, ref), isNull(registryTags.deletedAt)))
    fresh = !!t && Date.now() - t.at.getTime() < REFRESH_MS
  }
  if (!fresh) {
    const res = await upstream(up, `${path}/manifests/${ref}`, path, { accept: c.req.headers.get("accept") ?? ACCEPT }).catch(() => null)
    if (res?.ok) {
      const len = Number(res.headers.get("content-length") ?? 0)
      if (len > MAX_MANIFEST_BYTES) throw errors.manifestInvalid("The upstream manifest is too large.")
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.length > MAX_MANIFEST_BYTES) throw errors.manifestInvalid("The upstream manifest is too large.")
      await keep(await ensureRepo(name), bytes, res.headers.get("content-type"), ref)
    } else if (res?.status === 404 || res?.status === 401 || res?.status === 403) {
      await res.body?.cancel()
      throw res.status === 404 ? errors.manifestUnknown(ref) : new RegError("DENIED", "The upstream registry refused this image.", 403)
    } else if (!cached) {
      await res?.body?.cancel()
      throw res?.status === 429
        ? new RegError("TOOMANYREQUESTS", "The upstream registry is rate limiting this mirror.", 429)
        : new RegError("UNSUPPORTED", "The upstream registry couldn't be reached.", 502)
    }
    // Otherwise the upstream is down or limiting: the cached copy answers.
  }
  return getManifest(await ensureRepo(name), ref, head)
}

// Cached copies only (tags/list, referrers).
export async function mirrorRepo(c: C, name: string) {
  await gate(c, name)
  const r = await resolveRepo(name)
  if (!r) throw errors.nameUnknown(name)
  return r.repo
}

export async function mirrorBlob(c: C, name: string, digest: string, range: string | null, head: boolean) {
  const { up, path } = await gate(c, name)
  const r = await resolveRepo(name)
  if (!r) throw errors.nameUnknown(name)
  const { repo, namespace } = r
  const tokenId = c.actor.tokenId
  if (await linked(repo.id, digest)) return getBlob(repo.id, digest, range, head, tokenId)
  // Only blobs a cached manifest of this repo names: the mirror isn't an open proxy.
  const [named] = await db
    .select({ one: sql<number>`1` })
    .from(registryManifestRefs)
    .innerJoin(registryManifests, eq(registryManifests.id, registryManifestRefs.manifestId))
    .where(and(eq(registryManifests.repoId, repo.id), eq(registryManifestRefs.kind, "blob"), eq(registryManifestRefs.digest, digest)))
    .limit(1)
  if (!named) throw errors.blobUnknown(digest)
  // Another repo already stored these bytes.
  const [have] = await db.select({ d: registryBlobs.digest }).from(registryBlobs).where(eq(registryBlobs.digest, digest))
  if (have) {
    await db.insert(registryRepoBlobs).values({ repoId: repo.id, digest }).onConflictDoNothing()
    return getBlob(repo.id, digest, range, head, tokenId)
  }
  const res = await upstream(up, `${path}/blobs/${digest}`, path, { method: head ? "HEAD" : "GET", signal: AbortSignal.timeout(head ? 30_000 : 3_600_000) }).catch(() => null)
  if (!res?.ok) {
    await res?.body?.cancel()
    throw res?.status === 404 ? errors.blobUnknown(digest) : new RegError("UNSUPPORTED", "The upstream registry couldn't be reached.", 502)
  }
  const headers = {
    "Docker-Content-Digest": digest,
    "Content-Type": "application/octet-stream",
    ETag: `"${digest}"`,
    ...(res.headers.get("content-length") && { "Content-Length": res.headers.get("content-length")! }),
  }
  if (head) return respond(200, null, headers)

  // The client and the cache fill from one read of the upstream, each at its own pace: a chunk
  // is read only when the client asks, and written to the cache before the next.
  const reader = res.body!.getReader()
  const cache = new TransformStream<Uint8Array, Uint8Array>()
  const writer = cache.writable.getWriter()
  const row = await startUpload(repo.id, null)
  patch(row, cache.readable)
    .then((next) => finish(next, namespace, digest, null))
    .catch(async (e) => {
      console.error(`[registry] mirror cache of ${digest}:`, (e as Error).message)
      await discard(row).catch(() => {})
    })
  const abort = (e: unknown) => void writer.abort(e).catch(() => {})
  const client = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          await writer.close()
          return ctl.close()
        }
        await writer.write(value)
        ctl.enqueue(value)
      } catch (e) {
        abort(e)
        ctl.error(e)
      }
    },
    // The client left: the cache still gets the rest.
    async cancel() {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return void (await writer.close())
          await writer.write(value)
        }
      } catch (e) {
        abort(e)
      }
    },
  })
  return respond(200, await throttle(tokenId, client), headers)
}

// Daily: trash cached tags nobody pulled within their upstream's ttlDays (purged with the rest of
// the trash; the manifests and blobs follow in GC).
export async function expireMirror() {
  let n = 0
  for (const u of await db.select().from(registryUpstreams)) {
    const gone = await db.execute(sql`update registry_tags t set deleted_at = now()
      where t.deleted_at is null
        and coalesce(t.last_pulled_at, t.pushed_at) < now() - make_interval(days => ${u.ttlDays})
        and t.repo_id in (select r.id from registry_repos r join registry_namespaces ns on ns.id = r.namespace_id
          where lower(ns.name) = 'mirror' and ns.kind = 'org' and ns.ref_id = 'system' and starts_with(r.name, ${`${u.name}/`}))
      returning t.id`)
    n += gone.length
  }
  return n
}
