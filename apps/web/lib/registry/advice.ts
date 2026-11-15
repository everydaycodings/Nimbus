// Base-image advice: which image this one was built FROM, which newer tags of the same variant exist upstream
// (listed through the pull-through mirror's upstream settings), and how many vulnerabilities each would carry
// (a remote Trivy scan of up to two). Computed by the worker (job registry-advice), cached 24 h in registry_advice.
import "server-only"

import { and, desc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { registryAdvice, registryBuilds, registryScans, registryUpstreams } from "@/lib/db/schema"
import { enqueue } from "@/lib/redis"
import { getText } from "@/lib/s3"

import { baseFromOs, parseImageRef, pickCandidates, type Counts } from "./extras-rules.ts"
import { docOf, readConfig, resolveImage } from "./insights.ts"
import { upstream } from "./mirror.ts"
import { scanAvailable, scanRemote } from "./scan.ts"

export type Advice = {
  base: { name: string; tag: string; source: "annotation" | "dockerfile" | "history" | null } | null
  current?: Counts
  suggestions: { tag: string; reason: string; counts?: Counts; sizeDelta?: number }[]
  checkedAt: Date | null
  status: "ready" | "pending" | "unavailable"
  note?: string
}

const DAY = 24 * 3600_000
const BASE = "org.opencontainers.image.base.name"
const REASON = { patch: "Newest patch release of the same minor version", minor: "Newest release in the same major version", major: "Newest major version (may need code changes)" }

type Stored = Omit<Advice, "checkedAt">
type Base = NonNullable<Advice["base"]> & { registry: string; repo: string }

async function detectBase(repoId: string, digest: string): Promise<Base | null> {
  const img = await resolveImage(repoId, digest)
  if (!img) return null
  const from = (ref: string | undefined, source: "annotation" | "dockerfile") => {
    const p = ref ? parseImageRef(ref) : null
    return p ? ({ name: p.repo.replace(/^library\//, ""), tag: p.tag, source, registry: p.registry, repo: p.repo } as Base) : null
  }
  // 1. The annotation BuildKit sets (manifest, index or image config).
  const cfg = await readConfig(img.m)
  const ann = img.index ? { ...docOf(img.index).annotations, ...docOf(img.m).annotations } : docOf(img.m).annotations
  const a = from(ann?.[BASE] ?? cfg?.config?.Labels?.[BASE], "annotation")
  if (a) return a
  // 2. The FROM of a Nimbus build: BuildKit's log says "load metadata for <image>".
  const digests = [img.m.digest, ...(img.index ? [img.index.digest] : [])]
  for (const d of digests) {
    const [b] = await db.select({ tail: registryBuilds.logTail, key: registryBuilds.logKey }).from(registryBuilds).where(and(eq(registryBuilds.repoId, repoId), eq(registryBuilds.digest, d))).orderBy(desc(registryBuilds.createdAt)).limit(1)
    if (!b) continue
    let log = b.tail
    if (b.key) log = await getText(b.key).catch(() => b.tail)
    // ponytail: the last FROM wins (the final stage in most Dockerfiles); a multi-stage build whose last stage
    // starts from an earlier stage name is skipped by the scratch/stage filter below.
    const refs = [...log.matchAll(/load metadata for (\S+)/g)].map((m) => m[1]).filter((r) => !/^(docker-image:\/\/)?(scratch|moby\/buildkit)/.test(r))
    const f = from(refs.at(-1)?.replace(/^docker-image:\/\//, ""), "dockerfile")
    if (f) return f
  }
  // 3. The operating system Trivy found (alpine 3.10.9 -> alpine:3.10).
  const [s] = await db.select({ os: registryScans.os }).from(registryScans).where(eq(registryScans.manifestId, img.m.id))
  const o = baseFromOs(s?.os ?? null)
  return o ? { name: o.name.replace(/^library\//, ""), tag: o.tag, source: "history", registry: "docker.io", repo: o.name } : null
}

async function upstreamFor(registry: string) {
  const host = registry === "docker.io" ? "registry-1.docker.io" : registry
  const all = await db.select().from(registryUpstreams).where(eq(registryUpstreams.enabled, true))
  return all.find((u) => new URL(u.url).hostname === host) ?? null
}

// Every tag the upstream lists (first 5,000 at most).
async function upstreamTags(u: Awaited<ReturnType<typeof upstreamFor>> & object, repo: string): Promise<string[]> {
  const tags: string[] = []
  let next: string | null = `${repo}/tags/list?n=1000`
  for (let i = 0; next && i < 5; i++) {
    const res = await upstream(u, next, repo)
    if (!res.ok) throw new Error(`The upstream registry answered ${res.status}.`)
    tags.push(...(((await res.json()) as { tags?: string[] }).tags ?? []))
    const link: string | null = res.headers.get("link")
    next = /<\/v2\/([^>]+)>;\s*rel="next"/.exec(link ?? "")?.[1] ?? null
  }
  return tags
}

async function currentCounts(repoId: string, digest: string): Promise<Counts | undefined> {
  const img = await resolveImage(repoId, digest)
  if (!img) return undefined
  const [s] = await db.select().from(registryScans).where(eq(registryScans.manifestId, img.m.id))
  return s?.status === "done" ? { critical: s.critical, high: s.high, medium: s.medium, low: s.low } : undefined
}

async function compute(repoId: string, digest: string): Promise<Stored> {
  const base = await detectBase(repoId, digest)
  const current = await currentCounts(repoId, digest)
  if (!base) return { base: null, current, suggestions: [], status: "ready", note: "Couldn't tell which base image this was built from." }
  const pub = { name: base.name, tag: base.tag, source: base.source }
  const u = await upstreamFor(base.registry)
  if (!u) return { base: pub, current, suggestions: [], status: "ready", note: `${base.registry} isn't set up as a pull-through upstream, so its tags can't be listed.` }
  const cands = pickCandidates(base.tag, await upstreamTags(u, base.repo))
  if (!cands.length) return { base: pub, current, suggestions: [], status: "ready", note: "No newer tag of the same variant was found." }
  const canScan = await scanAvailable()
  const host = base.registry
  const suggestions: Stored["suggestions"] = []
  for (const [i, c] of cands.entries()) {
    let counts: Counts | undefined
    // Two scans at most: the scanner's remote mode is one at a time and a big image takes a while.
    if (canScan && i < 2) counts = await scanRemote(`${host}/${base.repo}:${c.tag}`).catch(() => undefined)
    suggestions.push({ tag: c.tag, reason: REASON[c.level], ...(counts && { counts }) })
  }
  return { base: pub, current, suggestions, status: "ready", ...(canScan ? {} : { note: "The scanner is off, so the candidates weren't scanned." }) }
}

// The job (registry-advice): compute and cache. A failure is cached too ("unavailable"), so a page doesn't retry on every view.
export async function runAdvice(repoId: string, digest: string): Promise<void> {
  let result: Stored
  try {
    result = await compute(repoId, digest)
  } catch (e) {
    result = { base: null, suggestions: [], status: "unavailable", note: (e as Error).message.slice(0, 200) }
  }
  await db.insert(registryAdvice).values({ repoId, digest, result, checkedAt: new Date() }).onConflictDoUpdate({ target: [registryAdvice.repoId, registryAdvice.digest], set: { result, checkedAt: new Date() } })
}

export async function requestAdvice(repoId: string, digest: string): Promise<void> {
  await enqueue("registry-advice", { repoId, digest }, { jobId: `registry-advice-${repoId}-${digest}` })
}

// The cached advice. Nothing cached: pending, and the job is queued; older than 24 h: shown, and refreshed.
export async function baseImageAdvice(repoId: string, digest: string): Promise<Advice> {
  const [row] = await db.select().from(registryAdvice).where(and(eq(registryAdvice.repoId, repoId), eq(registryAdvice.digest, digest)))
  if (!row || Date.now() - row.checkedAt.getTime() > DAY) await requestAdvice(repoId, digest).catch(() => {})
  if (!row) return { base: null, suggestions: [], checkedAt: null, status: "pending" }
  return { ...(row.result as Stored), checkedAt: row.checkedAt }
}
