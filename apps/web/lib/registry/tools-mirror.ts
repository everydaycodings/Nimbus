// Registry Cleanup & Mirror, the mirror side: copies tags of an upstream image into a Nimbus repo over the
// registry v2 API (Bearer or Basic login through mirror.ts' upstream()). Every platform manifest and its blobs
// come across, streamed through the same upload path a docker push uses. A tag whose digest hasn't changed is skipped.
import "server-only"

import { and, eq, isNull } from "drizzle-orm"

import { db } from "@/lib/db"
import { registryNamespaces, registryRepos, registryTags, type registryMirrors } from "@/lib/db/schema"
import { checkAddress, blockPrivateHosts } from "@/lib/secrets/egress"

import { linked, linkExisting } from "./blobs.ts"
import {
  DOCKER_LIST, DOCKER_MANIFEST, INDEXES, OCI_INDEX, OCI_MANIFEST, hashOf, type Desc,
} from "./manifests.ts"
import { keep, upstream } from "./mirror.ts"
import { MAX_MANIFEST_BYTES, matchPattern, parseDigest } from "./rules.ts"
import { isGlob, parseUpstream, pickTags } from "./tools-rules.ts"
import { discard, finish, startUpload } from "./uploads.ts"

type Mirror = typeof registryMirrors.$inferSelect

const ACCEPT = [OCI_INDEX, DOCKER_LIST, OCI_MANIFEST, DOCKER_MANIFEST].join(", ")

export type SyncResult = {
  digests: Record<string, string>
  copied: number
  skipped: number
  bytes: number
  // Tags whose digest moved since the last run (not first sightings).
  changed: { tag: string; from: string; to: string }[]
  errors: { tag: string; error: string }[]
  lines: string[]
}

// The upstream host must resolve and may not be this server's own database or Redis (SECRETS_BLOCK_PRIVATE=1 also refuses private ones).
export async function checkUpstream(ref: string) {
  const p = parseUpstream(ref)
  if ("error" in p) return p
  const u = new URL(p.url)
  try {
    await checkAddress(u.hostname, Number(u.port) || (u.protocol === "http:" ? 80 : 443), !blockPrivateHosts())
  } catch (e) {
    return { error: (e as Error).message }
  }
  return p
}

async function fail(res: Response, what: string): Promise<never> {
  await res.body?.cancel()
  throw new Error(
    res.status === 401 || res.status === 403 ? `The upstream refused ${what}. Check the login.`
    : res.status === 404 ? `${what} wasn't found upstream.`
    : res.status === 429 ? "The upstream is rate limiting this server."
    : `The upstream answered ${res.status} for ${what}.`
  )
}

export async function syncMirror(m: Mirror): Promise<SyncResult> {
  const p = await checkUpstream(m.upstream)
  if ("error" in p) throw new Error(p.error)
  const path = p.path
  const [target] = await db
    .select({ repo: registryRepos, ns: registryNamespaces })
    .from(registryRepos)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(and(eq(registryRepos.id, m.targetRepoId), isNull(registryRepos.deletedAt)))
  if (!target) throw new Error("The target repo is gone.")
  if (target.repo.archivedAt) throw new Error("The target repo is archived.")
  const { repo, ns } = target
  // The login stays sealed: upstream() opens it per request.
  const cred = { id: m.id, url: p.url, username: m.username, passwordEnc: m.passwordEnc }

  let all: string[] = []
  if (m.tags.split(",").some((t) => isGlob(t.trim()))) {
    for (let last = "", page = 0; page < 20; page++) {
      const res = await upstream(cred, `${path}/tags/list?n=1000${last ? `&last=${encodeURIComponent(last)}` : ""}`, path)
      if (!res.ok) await fail(res, "the tag list")
      const names = (((await res.json()) as { tags?: string[] }).tags ?? [])
      all = all.concat(names)
      if (names.length < 1000) break
      last = names[names.length - 1]
    }
  }
  const picked = pickTags(m.tags, all, m.cap)
  const out: SyncResult = { digests: {}, copied: 0, skipped: 0, bytes: 0, changed: [], errors: [], lines: [] }
  if (!picked.length) throw new Error("No upstream tag matches. Check the Tags field.")

  const get = async (ref: string) => {
    const res = await upstream(cred, `${path}/manifests/${ref}`, path, { accept: ACCEPT })
    if (!res.ok) await fail(res, `${path}:${ref}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > MAX_MANIFEST_BYTES) throw new Error("An upstream manifest is too large.")
    return { bytes, type: res.headers.get("content-type"), digest: res.headers.get("docker-content-digest") ?? hashOf("sha256", bytes) }
  }

  async function blob(d: Desc) {
    const digest = d.digest!
    if (parseDigest(digest)?.algo !== "sha256") throw new Error(`Blob ${digest} isn't sha256.`)
    if ((await linked(repo.id, digest)) || (await linkExisting(repo.id, ns, digest))) return
    const res = await upstream(cred, `${path}/blobs/${digest}`, path, { signal: AbortSignal.timeout(3_600_000) })
    if (!res.ok || !res.body) return fail(res, `blob ${digest.slice(0, 19)}`)
    const row = await startUpload(repo.id, m.userId)
    try {
      await finish(row, ns, digest, res.body)
    } catch (e) {
      await discard(row).catch(() => {})
      throw e
    }
    out.bytes += d.size ?? 0
  }

  // One image manifest: its blobs first, then the manifest (by digest, or with the tag).
  async function image(bytes: Buffer, type: string | null, ref: string) {
    const doc = JSON.parse(bytes.toString("utf8")) as { config?: Desc; layers?: Desc[]; blobs?: Desc[] }
    for (const d of [doc.config, ...(doc.layers ?? doc.blobs ?? [])])
      if (d?.digest && parseDigest(d.digest) && !d.urls?.length) await blob(d)
    await keep(repo, bytes, type, ref)
  }

  for (const tag of picked) {
    try {
      if (repo.immutablePattern && matchPattern(repo.immutablePattern, tag)) {
        const [t] = await db.select({ d: registryTags.digest }).from(registryTags).where(and(eq(registryTags.repoId, repo.id), eq(registryTags.name, tag), isNull(registryTags.deletedAt)))
        if (t) throw new Error(`Tag ${tag} is immutable in ${ns.name}/${repo.name}.`)
      }
      const top = await get(tag)
      const [have] = await db
        .select({ d: registryTags.digest })
        .from(registryTags)
        .where(and(eq(registryTags.repoId, repo.id), eq(registryTags.name, tag), isNull(registryTags.deletedAt)))
      const before = m.lastDigests[tag]
      if (before === top.digest && have?.d === top.digest) {
        out.digests[tag] = top.digest
        out.skipped++
        out.lines.push(`${tag}: unchanged`)
        continue
      }
      const mediaType = (JSON.parse(top.bytes.toString("utf8")) as { mediaType?: string }).mediaType ?? top.type?.split(";")[0].trim() ?? ""
      if (INDEXES.includes(mediaType)) {
        const kids = ((JSON.parse(top.bytes.toString("utf8")) as { manifests?: Desc[] }).manifests ?? []).filter((d) => d.digest && parseDigest(d.digest))
        for (const d of kids) {
          const c = await get(d.digest!)
          if (c.digest !== d.digest) throw new Error("The upstream sent a manifest that doesn't match its digest.")
          await image(c.bytes, c.type, d.digest!)
        }
        await keep(repo, top.bytes, top.type, tag)
        out.lines.push(`${tag}: copied ${kids.length} platform${kids.length === 1 ? "" : "s"}`)
      } else {
        await image(top.bytes, top.type, tag)
        out.lines.push(`${tag}: copied`)
      }
      out.digests[tag] = top.digest
      out.copied++
      if (before && before !== top.digest) out.changed.push({ tag, from: before, to: top.digest })
    } catch (e) {
      out.errors.push({ tag, error: (e as Error).message })
      out.lines.push(`${tag}: failed, ${(e as Error).message}`)
      // A failed tag keeps its old digest, so the next run tries it again.
      if (m.lastDigests[tag]) out.digests[tag] = m.lastDigests[tag]
    }
  }
  return out
}
