// Image policies: per name or org, max Critical/High, max age, require signed, blocked licenses, and optionally
// refuse pulls of images that fail. The checks themselves are pure (evaluateImagePolicy in extras-rules.ts).
import "server-only"

import { createHash } from "node:crypto"

import { and, eq, inArray, isNull } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { registryManifestRefs, registryManifests, registryNamespaces, registryRepos, registryScans, registryTags } from "@/lib/db/schema"
import { redis } from "@/lib/redis"

import { logEvent } from "./activity.ts"
import { MIRROR_REF, roleIn } from "./access.ts"
import { artifactsFor } from "./artifacts.ts"
import { cleanImagePolicy, evaluateImagePolicy, isArtifactManifest, type Check, type Facts, type ImagePolicy, type Verdict } from "./extras-rules.ts"
import { readConfig, resolveImage, type Manifest } from "./insights.ts"
import { namespaceLatestTags } from "./manage.ts"
import { isInternalToken } from "./scan.ts"
import { packagesFor } from "./sbom.ts"

export type { ImagePolicy, Check, Verdict }
export type Evaluation = { verdict: Verdict; checks: Check[]; evaluatedAt: Date }

export async function getPolicy(namespaceId: string): Promise<ImagePolicy | null> {
  const [r] = await db.select({ p: registryNamespaces.imagePolicy }).from(registryNamespaces).where(eq(registryNamespaces.id, namespaceId))
  return r?.p ?? null
}

// Owners of the name (or org owners) only. null removes the policy.
export async function setPolicy(actorUserId: string, namespaceId: string, p: ImagePolicy | null): Promise<{ error?: string }> {
  const [ns] = await db.select().from(registryNamespaces).where(eq(registryNamespaces.id, namespaceId))
  if (!ns || ns.refId === MIRROR_REF) return { error: "That name doesn't exist." }
  if ((await roleIn(actorUserId, ns)) !== "owner") return { error: "Only an owner can change the image policy." }
  const next = p ? cleanImagePolicy(p) : null
  await db.update(registryNamespaces).set({ imagePolicy: next }).where(eq(registryNamespaces.id, namespaceId))
  const [u] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, actorUserId))
  const detail = next ? JSON.stringify(next) : "removed"
  await audit("registry_image_policy", { detail: `${ns.name}: ${detail}` })
  await logEvent({ namespaceId, actorId: actorUserId, actorName: u?.name || u?.email || "An owner", action: "policy.image", detail: { policy: next } })
  return {}
}

// ---- Facts ----

const createdKey = (digest: string) => `registry:created:${digest}`

// When the image was built (config "created"), else when it was pushed. Config reads are cached: a digest never changes.
async function ageDays(repoId: string, m: Manifest, fallback: Date): Promise<number> {
  let created = await redis.get(createdKey(m.digest)).catch(() => null)
  if (!created) {
    const img = await resolveImage(repoId, m.digest)
    created = (img && (await readConfig(img.m))?.created) || ""
    await redis.set(createdKey(m.digest), created || fallback.toISOString(), "EX", 30 * 86400).catch(() => {})
    created ||= fallback.toISOString()
  }
  const t = Date.parse(created)
  return Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 86_400_000) : 0
}

async function factsFor(repoId: string, policy: ImagePolicy, digests: string[]): Promise<Record<string, Facts>> {
  const ms = await db.select().from(registryManifests).where(and(eq(registryManifests.repoId, repoId), inArray(registryManifests.digest, digests), isNull(registryManifests.deletedAt)))
  const by = new Map(ms.map((m) => [m.digest, m]))
  const scans = ms.length ? await db.select().from(registryScans).where(inArray(registryScans.manifestId, ms.map((m) => m.id))) : []
  const scanOf = new Map(scans.filter((s) => s.status === "done").map((s) => [s.manifestId, s]))

  // Signed: the image itself, or an index that lists it (the signature is on the index, clients pull the child).
  let signed = new Map<string, boolean>()
  if (policy.requireSigned) {
    const parents = await db
      .select({ child: registryManifestRefs.digest, parent: registryManifests.digest })
      .from(registryManifestRefs)
      .innerJoin(registryManifests, and(eq(registryManifests.id, registryManifestRefs.manifestId), isNull(registryManifests.deletedAt)))
      .where(and(eq(registryManifests.repoId, repoId), eq(registryManifestRefs.kind, "manifest"), inArray(registryManifestRefs.digest, digests)))
    const all = [...new Set([...digests, ...parents.map((p) => p.parent)])]
    const found = await artifactsFor(repoId, all)
    const ok = (d: string) => (found[d]?.signatures ?? 0) > 0
    signed = new Map(digests.map((d) => [d, ok(d) || parents.some((p) => p.child === d && ok(p.parent))]))
  }

  const tags = policy.maxAgeDays != null ? await db.select({ digest: registryTags.digest, at: registryTags.pushedAt }).from(registryTags).where(and(eq(registryTags.repoId, repoId), inArray(registryTags.digest, digests), isNull(registryTags.deletedAt))) : []

  const out: Record<string, Facts> = {}
  for (const d of digests) {
    const m = by.get(d)
    const s = m && scanOf.get(m.id)
    out[d] = {
      critical: s ? s.critical : null,
      high: s ? s.high : null,
      ageDays: m && policy.maxAgeDays != null ? await ageDays(repoId, m, tags.find((t) => t.digest === d)?.at ?? m.createdAt) : null,
      signed: policy.requireSigned ? signed.get(d) ?? false : null,
      licenses: policy.blockedLicenses?.length && m ? await licensesOf(repoId, d) : null,
    }
  }
  return out
}

async function licensesOf(repoId: string, digest: string): Promise<string[] | null> {
  const r = await packagesFor(repoId, digest)
  return r.source ? r.packages.flatMap((p) => p.licenses) : null
}

const NO_FACTS: Facts = { critical: null, high: null, ageDays: null, signed: null, licenses: null }

// How each digest does against a given policy (no policy: passes with no checks). Nothing is saved.
async function evaluateWith(repoId: string, policy: ImagePolicy, digests: string[]): Promise<Record<string, Evaluation>> {
  const now = new Date()
  const facts = Object.keys(policy).length && digests.length ? await factsFor(repoId, policy, digests) : {}
  return Object.fromEntries(digests.map((d) => [d, { ...evaluateImagePolicy(policy, facts[d] ?? NO_FACTS), evaluatedAt: now }]))
}

// For the badge and panel: how each digest does against its namespace's saved policy.
export async function evaluateTags(repoId: string, digests: string[]): Promise<Record<string, Evaluation>> {
  const [row] = await db.select({ p: registryNamespaces.imagePolicy }).from(registryRepos).innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId)).where(eq(registryRepos.id, repoId))
  return evaluateWith(repoId, row?.p ?? {}, digests)
}

// What a policy (usually an unsaved draft) would say about the newest tag of each repository in a name.
export type PolicyPreview = { total: number; failing: { repo: string; tag: string; reason: string }[]; unknown: number }
export async function previewPolicy(namespaceId: string, draft: ImagePolicy | null): Promise<PolicyPreview> {
  const policy = (draft && cleanImagePolicy(draft)) || {}
  const [ns] = await db.select({ name: registryNamespaces.name }).from(registryNamespaces).where(eq(registryNamespaces.id, namespaceId))
  const latest = await namespaceLatestTags(namespaceId)
  const failing: PolicyPreview["failing"] = []
  let unknown = 0
  for (const l of latest) {
    const e = (await evaluateWith(l.repoId, policy, [l.digest]))[l.digest]
    if (e.verdict === "unknown") unknown++
    if (e.verdict !== "fail") continue
    const bad = e.checks.find((c) => c.state === "fail")
    failing.push({ repo: `${ns?.name}/${l.repo}`, tag: l.tag, reason: bad ? `${bad.label}: ${bad.detail}` : "Failed" })
  }
  return { total: latest.length, failing, unknown }
}

// ---- Enforcement (manifest GET/HEAD) ----

// The message to refuse the pull with, or null. Only when the name's policy has "block pulls", and only for a
// real fail: facts that aren't known (not scanned yet) don't block unless the policy says unscanned images fail. Never for the mirror,
// the scanner's and builder's own tokens, or signatures/SBOMs/attestations. A failure here never blocks a pull.
export async function blockedByImagePolicy(repo: { id: string; namespaceId: string }, m: Manifest, tokenId: string | null, tag: string | null): Promise<string | null> {
  try {
    const [ns] = await db.select().from(registryNamespaces).where(eq(registryNamespaces.id, repo.namespaceId))
    const policy = ns?.imagePolicy
    if (!ns || !policy?.blockPulls || ns.refId === MIRROR_REF) return null
    if (isArtifactManifest(JSON.parse(m.bytes.toString("utf8")), tag ?? undefined) || (await isInternalToken(tokenId))) return null
    // The verdict is kept for a minute (it reads the scan, signatures and maybe SBOMs); the policy's hash is in the key.
    const key = `registry:polblock:${m.id}:${createHash("sha1").update(JSON.stringify(policy)).digest("hex").slice(0, 12)}`
    let verdict = await redis.get(key).catch(() => null)
    if (verdict === null) {
      const ev = (await evaluateTags(repo.id, [m.digest]))[m.digest]
      const bad = ev.checks.find((c) => c.state === "fail")
      verdict = bad ? `Image fails the ${ns.name} policy: ${bad.label} (${bad.detail})` : ""
      await redis.set(key, verdict, "EX", 60).catch(() => {})
    }
    return verdict || null
  } catch (e) {
    console.error("[registry] policy check:", e)
    return null
  }
}
