// Vulnerability scanning with Trivy (the optional registry-scan service, scripts/registry-scan.ts).
// An image pushed with a tag is queued; the worker scans it (an index: every platform, the
// summary is the worst of each), stores counts and a compact report, tells the owners when
// criticals appear, and fires the "scan" webhook. "Block pull if Critical" is checked on the
// manifest GET by blockedByScan. Unscanned images are never blocked.
import "server-only"

import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { registryManifestRefs, registryManifests, registryNamespaces, registryRepos, registryScans, registryTags, registryTokenRepos, registryTokens } from "@/lib/db/schema"
import { notify } from "@/lib/notify"
import { enqueue, redis } from "@/lib/redis"
import { getSettings } from "@/lib/signup"

import { namespaceOwners } from "./events.ts"
import { attestationRefs, compact, count, maxOf, newCriticals, parseTrivyFull, type Pkg, type Vuln } from "./extras-rules.ts"
import { emit } from "./hooks.ts"
import { INDEXES } from "./manifests.ts"
import { endpoint, newToken } from "./rules.ts"

type Status = "pending" | "running" | "done" | "failed"
type Summary = { status: Status; critical: number; high: number; medium: number; low: number; scannedAt: Date | null }

export async function scanAvailable(): Promise<boolean> {
  return Boolean(process.env.REGISTRY_SCAN_URL) && (await getSettings()).registryScan
}

export async function scanSummaries(manifestIds: string[]): Promise<Record<string, Summary>> {
  if (!manifestIds.length) return {}
  const rows = await db
    .select({ id: registryScans.manifestId, status: registryScans.status, critical: registryScans.critical, high: registryScans.high, medium: registryScans.medium, low: registryScans.low, scannedAt: registryScans.scannedAt })
    .from(registryScans)
    .where(inArray(registryScans.manifestId, manifestIds))
  return Object.fromEntries(rows.map(({ id, ...s }) => [id, s]))
}

export async function scanReport(manifestId: string): Promise<{ vulns: Vuln[]; error: string | null } | null> {
  const [r] = await db.select({ report: registryScans.report, error: registryScans.error }).from(registryScans).where(eq(registryScans.manifestId, manifestId))
  return r ? { vulns: (r.report as Vuln[] | null) ?? [], error: r.error } : null
}

// Queues a scan. A scan still waiting for the worker is not queued twice (same job id).
export async function requestScan(manifestId: string): Promise<void> {
  await db.insert(registryScans).values({ manifestId, status: "pending" }).onConflictDoUpdate({ target: registryScans.manifestId, set: { status: "pending", error: null } })
  await enqueue("registry-scan", { manifestId }, { jobId: `registry-scan-${manifestId}` })
}

// ---- Block pull ------------------------------------------------------------

const scanTokenKey = (id: string) => `registry:scan-token:${id}`
const isScanToken = async (id: string | null) => Boolean(id) && (await redis.exists(scanTokenKey(id!))) === 1
// The scanner's and the build runner's own tokens (build-ops.ts keeps the second key): never blocked by a policy.
export const isInternalToken = async (id: string | null) => Boolean(id) && (await redis.exists(scanTokenKey(id!), `registry:build:token:${id}`)) > 0

// Throws-by-return: the message to refuse the pull with, or null. The scanner's own token is let through
// (it has to read a blocked image to rescan it).
export async function blockedByScan(repo: { blockCritical: boolean }, manifestId: string, tokenId: string | null): Promise<string | null> {
  if (!repo.blockCritical) return null
  const [s] = await db.select({ critical: registryScans.critical }).from(registryScans).where(eq(registryScans.manifestId, manifestId))
  if (!s || s.critical <= 0 || (await isScanToken(tokenId).catch(() => false))) return null
  return "Image has critical vulnerabilities (blocked by repository policy)"
}

// ---- The scan job ------------------------------------------------------------

const TOKEN_MINUTES = 10

function target() {
  const override = process.env.REGISTRY_SCAN_REGISTRY?.trim()
  const ep = endpoint()
  if (!ep && !override) throw new Error("The registry isn't turned on.")
  return { host: override || ep!.replace(/^https?:\/\//, ""), insecure: Boolean(override) || ep!.startsWith("http:") }
}

async function trivy(body: object) {
  const r = await fetch(`${process.env.REGISTRY_SCAN_URL}/scan`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-scan-secret": process.env.REGISTRY_SCAN_SECRET ?? "" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10 * 60_000),
  })
  if (!r.ok) throw new Error((await r.text()).replace(/\s+/g, " ").slice(0, 300) || `The scanner answered ${r.status}.`)
  return parseTrivyFull(await r.json())
}

// A public image from another registry, scanned without credentials (base-image advice): severity counts only.
export async function scanRemote(ref: string) {
  if (!(await scanAvailable())) throw new Error("The scanner isn't turned on.")
  return count((await trivy({ ref, remote: true })).vulns)
}

const put = (manifestId: string, v: Partial<typeof registryScans.$inferInsert>) =>
  db.insert(registryScans).values({ manifestId, ...v }).onConflictDoUpdate({ target: registryScans.manifestId, set: v })

export async function runScan(manifestId: string) {
  const [row] = await db
    .select({ m: registryManifests, repo: registryRepos, ns: registryNamespaces })
    .from(registryManifests)
    .innerJoin(registryRepos, eq(registryRepos.id, registryManifests.repoId))
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(eq(registryManifests.id, manifestId))
  if (!row || row.m.deletedAt || row.repo.deletedAt || !(await scanAvailable())) return
  const { m, repo, ns } = row
  const owner = (await namespaceOwners(ns.id))[0]
  if (!owner) return
  const [before] = await db.select({ critical: registryScans.critical, status: registryScans.status }).from(registryScans).where(eq(registryScans.manifestId, manifestId))
  const seen = before?.status === "done" ? before.critical : null
  await put(manifestId, { status: "running", error: null })

  // What to scan: the manifest, or every platform image of an index (not buildx's attestation manifests).
  let targets = [{ id: m.id, digest: m.digest, arch: true }]
  if (INDEXES.includes(m.mediaType)) {
    const skip = new Set(attestationRefs(JSON.parse(m.bytes.toString("utf8"))).map((a) => a.digest))
    const kids = await db
      .select({ id: registryManifests.id, digest: registryManifests.digest })
      .from(registryManifestRefs)
      .innerJoin(registryManifests, and(eq(registryManifests.repoId, repo.id), eq(registryManifests.digest, registryManifestRefs.digest), isNull(registryManifests.deletedAt)))
      .where(and(eq(registryManifestRefs.manifestId, m.id), eq(registryManifestRefs.kind, "manifest")))
    const hostArch = process.arch === "x64" ? "amd64" : process.arch
    const platformOf = new Map((JSON.parse(m.bytes.toString("utf8")).manifests ?? []).map((d: { digest: string; platform?: { architecture?: string } }) => [d.digest, d.platform?.architecture]))
    targets = kids.filter((k) => !skip.has(k.digest)).map((k) => ({ ...k, arch: platformOf.get(k.digest) === hostArch }))
  }

  // A short-lived pull token for this repo, owned by the namespace owner; gone when the scan is.
  const { prefix, secret, token } = newToken()
  const [tk] = await db
    .insert(registryTokens)
    .values({ userId: owner, name: "Nimbus scan", prefix, secretEnc: encrypt(secret), access: "pull", allRepos: false, expiresAt: new Date(Date.now() + TOKEN_MINUTES * 60_000) })
    .returning({ id: registryTokens.id })
  await db.insert(registryTokenRepos).values({ tokenId: tk.id, repoId: repo.id })
  await redis.set(scanTokenKey(tk.id), "1", "EX", TOKEN_MINUTES * 60 + 60)
  const name = `${ns.name}/${repo.name}`
  try {
    const { host, insecure } = target()
    const per: { counts: ReturnType<typeof count>; vulns: Vuln[]; packages: Pkg[]; truncated: boolean; os: { family: string; name: string } | null; arch: boolean }[] = []
    let error: string | null = null
    for (const t of targets) {
      try {
        await db.update(registryTokens).set({ expiresAt: new Date(Date.now() + TOKEN_MINUTES * 60_000) }).where(eq(registryTokens.id, tk.id))
        const { vulns, packages, truncated, os } = await trivy({ ref: `${host}/${name}@${t.digest}`, username: "nimbus", password: token, insecure })
        const counts = count(vulns)
        per.push({ counts, vulns, packages, truncated, os, arch: t.arch })
        // The platform image keeps its own result too, so pulling it by digest is checked.
        if (t.id !== m.id) await put(t.id, { status: "done", ...counts, report: compact(vulns), packages, packagesTruncated: truncated, os, error: null, scannedAt: new Date() })
      } catch (e) {
        error ??= (e as Error).message
      }
    }
    const sum = maxOf(per.map((p) => p.counts))
    if (error && !per.length) await put(manifestId, { status: "failed", error, scannedAt: new Date() })
    else {
      // The index (or single image) row keeps the package list of one image: the host architecture's, else the first.
      const main = per.find((p) => p.arch) ?? per[0]
      await put(manifestId, { status: error ? "failed" : "done", ...sum, report: compact(per.flatMap((p) => p.vulns)), packages: main.packages, packagesTruncated: main.truncated, os: main.os, error, scannedAt: new Date() })
      const [tag] = await db.select({ name: registryTags.name }).from(registryTags).where(and(eq(registryTags.repoId, repo.id), eq(registryTags.digest, m.digest), isNull(registryTags.deletedAt))).limit(1)
      await emit("scan", repo.id, { repository: name, tag: tag?.name ?? null, digest: m.digest, mediaType: m.mediaType, ...sum })
      if (newCriticals(seen, sum.critical))
        for (const id of await namespaceOwners(ns.id))
          await notify(id, "registry_scan", { data: { name: `${name}${tag ? `:${tag.name}` : ""}`, critical: String(sum.critical) } })
    }
  } finally {
    await db.delete(registryTokens).where(eq(registryTokens.id, tk.id))
    await redis.del(scanTokenKey(tk.id)).catch(() => {})
  }
}

// Daily: tagged images never scanned (pushed before scanning was on), last scanned over a day ago, or scanned
// before the package list was kept (the R6 backfill), 50 a run.
export async function runRescan() {
  if (!(await scanAvailable())) return { queued: 0 }
  const rows = await db.execute<{ id: string }>(sql`
    select m.id from registry_manifests m
      join registry_repos r on r.id = m.repo_id and r.deleted_at is null
      join registry_namespaces n on n.id = r.namespace_id and n.ref_id <> 'system'
      left join registry_scans s on s.manifest_id = m.id
    where m.deleted_at is null and m.artifact_type is null and m.subject is null
      and exists (select 1 from registry_tags t where t.repo_id = m.repo_id and t.digest = m.digest and t.deleted_at is null)
      and (s.id is null or (s.status in ('done', 'failed') and (s.scanned_at is null or s.scanned_at < now() - interval '24 hours' or (s.status = 'done' and s.packages is null))))
    order by s.scanned_at nulls first limit 50`)
  for (const r of rows) await requestScan(r.id)
  return { queued: rows.length }
}
