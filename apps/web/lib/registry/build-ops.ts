// What the build runner (scripts/registry-build.ts) asks the app to do, through POST /api/registry/runner:
// hand over a build's recipe and secrets, record progress, scan, tag, sign-key storage, and finish.
// The runner has no database code of its own; this is where the build touches Nimbus.
import "server-only"

import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm"

import { decrypt, encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { registryBuildRules, registryBuildSources, registryBuilds, registryManifests, registryNamespaces, registryRepos, registryTokenRepos, registryTokens, settings } from "@/lib/db/schema"
import { appUrl } from "@/lib/email"
import { notify } from "@/lib/notify"
import { redis } from "@/lib/redis"
import { putObject, removeObjects } from "@/lib/s3"
import { saveSettings } from "@/lib/audit"
import { getSettings } from "@/lib/signup"

import { logEvent } from "./activity.ts"
import { LOST, sourceCredential } from "./connections.ts"
import { resolveRefs } from "./build-secrets.ts"
import { buildChannel, buildLogKey } from "./build-rules.ts"
import { ACTIVE, BUILD_DEFAULTS, buildsAvailable, createBuild, tagsFor, type BuildStatus, type Spec } from "./builds.ts"
import { namespaceOwners } from "./events.ts"
import * as github from "./github.ts"
import { emit } from "./hooks.ts"
import { putManifest } from "./manifests.ts"
import { RegError } from "./http.ts"
import { endpoint, newToken } from "./rules.ts"
import { runScan, scanAvailable, scanReport, scanSummaries } from "./scan.ts"

const publish = (id: string, msg: object) => redis.publish(`events:${buildChannel(id)}`, JSON.stringify(msg)).catch(() => {})
const tokenKey = (id: string) => `registry:build:token:${id}`

// ---- settings ------------------------------------------------------------------------------------------

export async function runnerSettings() {
  const s = await getSettings()
  return {
    concurrency: Math.max(1, s.registryBuildConcurrency),
    timeoutMin: s.registryBuildTimeoutMin,
    preflight: { ramPct: s.registryBuildPreflightRamPct, minDiskGb: s.registryBuildMinDiskGb, loadFactor: 1.5 },
    guard: { ramPct: s.registryBuildGuardRamPct, minDiskGb: s.registryBuildGuardDiskGb },
    enabled: s.registryBuilds,
    defaults: BUILD_DEFAULTS,
  }
}

// ---- the recipe ----------------------------------------------------------------------------------------

export type Clone = { kind: "github" | "git"; url: string; username?: string; token?: string; sshKey?: string }

// "lost": the saved connection it used was deleted.
async function cloneOf(s: typeof registryBuildSources.$inferSelect): Promise<Clone | "lost" | null> {
  if (s.kind === "upload" || !s.url) return null
  const { cred, lost } = await sourceCredential(s)
  if (lost) return "lost"
  if (s.kind === "github") return { kind: "github", url: `https://github.com/${s.url}.git`, username: "x-access-token", token: cred?.token }
  return { kind: "git", url: s.url, ...cred }
}

export type Prepared =
  | { ok: false; error: string; skip?: boolean }
  | {
      ok: true
      buildId: string
      name: string
      image: string
      insecure: boolean
      ref: string | null
      refType: "branch" | "tag" | null
      commit: string | null
      rule: Spec["rule"]
      clone: Clone | null
      tarKey: string | null
      token: string
      secrets: Record<string, string>
      timeoutMin: number
    }

// The registry the build pushes to, as BuildKit (inside the compose network) reaches it.
export function buildTarget() {
  const override = (process.env.REGISTRY_BUILD_REGISTRY || process.env.REGISTRY_SCAN_REGISTRY)?.trim()
  const ep = endpoint()
  if (!override && !ep) throw new Error("The registry isn't turned on.")
  return { host: override || ep!.replace(/^https?:\/\//, ""), insecure: Boolean(override) || ep!.startsWith("http:") }
}

export async function prepare(buildId: string): Promise<Prepared> {
  const [row] = await db
    .select({ b: registryBuilds, repo: registryRepos, ns: registryNamespaces })
    .from(registryBuilds)
    .innerJoin(registryRepos, eq(registryRepos.id, registryBuilds.repoId))
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(eq(registryBuilds.id, buildId))
  if (!row) return { ok: false, error: "The build is gone.", skip: true }
  const { b, repo, ns } = row
  // Only a build that hasn't started is run (a restarted runner doesn't redo one).
  if (b.status !== "queued" && b.status !== "waiting") return { ok: false, error: "Already handled.", skip: true }
  if (repo.deletedAt || repo.archivedAt) return { ok: false, error: "The repository is archived or deleted." }
  if (!(await buildsAvailable(b.createdBy ?? undefined)).on) return { ok: false, error: "Image builds were turned off." }
  const spec = b.spec as unknown as Spec
  let target: ReturnType<typeof buildTarget>
  try {
    target = buildTarget()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  let secrets: Record<string, string> = {}
  try {
    secrets = await resolveRefs(spec.rule.secretRefs)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  let clone: Clone | null = null
  if (spec.source !== "upload") {
    const [src] = await db.select().from(registryBuildSources).where(eq(registryBuildSources.repoId, repo.id))
    const c = src ? await cloneOf(src) : null
    if (c === "lost") return { ok: false, error: LOST }
    clone = c
    if (!clone) return { ok: false, error: "The repository has no build source any more." }
  }
  const owner = (await namespaceOwners(ns.id))[0] ?? b.createdBy
  if (!owner) return { ok: false, error: "The namespace has no owner to push as." }
  const s = await getSettings()
  // A short-lived push token for this repo only, gone when the build is. Pushes by the runner are the owner's.
  const { prefix, secret, token } = newToken()
  const [tk] = await db
    .insert(registryTokens)
    .values({ userId: owner, name: "Nimbus build", prefix, secretEnc: encrypt(secret), access: "push", allRepos: false, expiresAt: new Date(Date.now() + (s.registryBuildTimeoutMin + 90) * 60_000) })
    .returning({ id: registryTokens.id })
  await db.insert(registryTokenRepos).values({ tokenId: tk.id, repoId: repo.id })
  await redis.set(tokenKey(buildId), tk.id, "EX", 24 * 3600)
  const name = `${ns.name}/${repo.name}`
  return {
    ok: true,
    buildId,
    name,
    image: `${target.host}/${name}`,
    insecure: target.insecure,
    ref: b.ref,
    refType: spec.refType ?? null,
    commit: b.commit,
    rule: spec.rule,
    clone,
    tarKey: spec.tarKey ?? null,
    token,
    secrets,
    timeoutMin: s.registryBuildTimeoutMin,
  }
}

// ---- progress --------------------------------------------------------------------------------------------

async function ctx(buildId: string) {
  const [row] = await db
    .select({ b: registryBuilds, repo: registryRepos, ns: registryNamespaces })
    .from(registryBuilds)
    .innerJoin(registryRepos, eq(registryRepos.id, registryBuilds.repoId))
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(eq(registryBuilds.id, buildId))
  return row ?? null
}

const link = (name: string, id: string) => appUrl(`/registry/${name}?tab=builds&build=${id}`)

async function ghStatus(buildId: string, state: "pending" | "success" | "failure" | "error", description: string) {
  try {
    const row = await ctx(buildId)
    if (!row?.b.commit) return
    const [src] = await db.select().from(registryBuildSources).where(eq(registryBuildSources.repoId, row.repo.id))
    if (src?.kind !== "github" || !src.url) return
    const token = (await sourceCredential(src)).cred?.token
    if (token && /^[0-9a-f]{40}$/.test(row.b.commit))
      await github.postStatus(token, src.url, row.b.commit, { state, url: link(`${row.ns.name}/${row.repo.name}`, buildId), description })
  } catch (e) {
    console.error("[registry] github status:", (e as Error).message)
  }
}

export async function progress(buildId: string, o: { status: "waiting" | "running"; reason?: string | null; commit?: string | null }) {
  const row = await ctx(buildId)
  if (!row || !ACTIVE.includes(row.b.status)) return { ok: false }
  const first = !row.b.startedAt && o.status === "running"
  const set: Partial<typeof registryBuilds.$inferInsert> = { status: o.status, reason: o.reason ?? null }
  if (first) set.startedAt = new Date()
  if (o.commit && !row.b.commit) {
    set.commit = o.commit
    set.tags = tagsFor(row.b.spec as unknown as Spec, row.b.ref, o.commit)
  }
  await db.update(registryBuilds).set(set).where(eq(registryBuilds.id, buildId))
  await publish(buildId, { status: o.status, reason: o.reason ?? null })
  if (first) await ghStatus(buildId, "pending", "Build started")
  return { ok: true }
}

// ---- scan, tag, sign key -----------------------------------------------------------------------------------

async function manifestOf(repoId: string, digest: string) {
  const [m] = await db.select().from(registryManifests).where(and(eq(registryManifests.repoId, repoId), eq(registryManifests.digest, digest), isNull(registryManifests.deletedAt)))
  return m ?? null
}

export type ScanResult = { state: "unavailable" } | { state: "failed"; error: string } | { state: "done"; critical: number; high: number; medium: number; low: number }

// Scans the pushed image now (waits for Trivy, up to its own 10 minute limit).
export async function scan(buildId: string, digest: string): Promise<ScanResult> {
  if (!(await scanAvailable())) return { state: "unavailable" }
  const row = await ctx(buildId)
  const m = row && (await manifestOf(row.repo.id, digest))
  if (!m) return { state: "failed", error: "The pushed image isn't in the registry." }
  await runScan(m.id).catch((e: Error) => console.error("[registry] build scan:", e.message))
  const sum = (await scanSummaries([m.id]))[m.id]
  if (!sum || sum.status !== "done") return { state: "failed", error: (await scanReport(m.id))?.error ?? "The scan didn't finish." }
  return { state: "done", critical: sum.critical, high: sum.high, medium: sum.medium, low: sum.low }
}

// Points each tag at the pushed image, like a docker push would (same checks: immutable tags, archived repos).
export async function tag(buildId: string, digest: string): Promise<{ tags: string[]; failed?: string }> {
  const row = await ctx(buildId)
  if (!row) return { tags: [], failed: "The build is gone." }
  const { b, repo, ns } = row
  const m = await manifestOf(repo.id, digest)
  if (!m) return { tags: [], failed: "The pushed image isn't in the registry." }
  const spec = b.spec as unknown as Spec
  const tags = b.commit || spec.source === "upload" ? tagsFor(spec, b.ref, b.commit ?? "0000000") : []
  if (!tags.length) return { tags: [], failed: "No tag could be made from the rule's templates for this build." }
  const owner = (await namespaceOwners(ns.id))[0] ?? b.createdBy
  const [who] = b.createdBy ? await db.select({ n: user.name }).from(user).where(eq(user.id, b.createdBy)) : []
  const name = `${ns.name}/${repo.name}`
  const done: string[] = []
  for (const t of tags) {
    try {
      await putManifest(
        {
          req: new Request("http://internal/", { method: "PUT", body: new Uint8Array(m.bytes), headers: { "content-type": m.mediaType } }),
          method: "PUT",
          path: "",
          q: new URLSearchParams(),
          actor: { userId: owner, tokenId: null, access: "delete", allRepos: true, repoIds: [] },
          who: { name: who?.n ?? "Nimbus builder", ip: null },
        },
        repo,
        name,
        t
      )
      done.push(t)
    } catch (e) {
      return { tags: done, failed: `Couldn't tag ${t}: ${e instanceof RegError ? e.message : (e as Error).message}` }
    }
  }
  await db.update(registryBuilds).set({ tags: done }).where(eq(registryBuilds.id, buildId))
  return { tags: done }
}

export async function cosignGet(): Promise<{ key: string; password: string } | null> {
  const [s] = await db.select({ enc: settings.registryCosignEnc }).from(settings)
  const raw = s?.enc ? decrypt(s.enc) : null
  return raw ? (JSON.parse(raw) as { key: string; password: string }) : null
}

export async function cosignSet(v: { key: string; password: string; pub: string }) {
  await saveSettings({ registryCosignEnc: encrypt(JSON.stringify({ key: v.key, password: v.password })), registryCosignPub: v.pub, updatedAt: new Date() })
}

// ---- schedules ----------------------------------------------------------------------------------------------

export async function scheduleInfo(ruleId: string) {
  const [r] = await db.select().from(registryBuildRules).where(eq(registryBuildRules.id, ruleId))
  if (!r || !r.enabled) return null
  const [src] = await db.select().from(registryBuildSources).where(eq(registryBuildSources.repoId, r.repoId))
  const clone = src ? await cloneOf(src) : null
  return clone && clone !== "lost" ? { sourceType: r.sourceType, pattern: r.pattern, clone } : null
}

export async function scheduleStart(ruleId: string, refs: { type: "branch" | "tag"; name: string; commit: string | null }[]) {
  const [r] = await db.select().from(registryBuildRules).where(eq(registryBuildRules.id, ruleId))
  if (!r || !r.enabled || !(await buildsAvailable()).on) return { started: 0 }
  const [src] = await db.select().from(registryBuildSources).where(eq(registryBuildSources.repoId, r.repoId))
  if (!src || src.kind === "upload") return { started: 0 }
  const [live] = await db.select({ n: sql<number>`count(*)::int` }).from(registryBuilds).where(and(eq(registryBuilds.ruleId, ruleId), inArray(registryBuilds.status, ACTIVE)))
  if (live.n) return { started: 0 }
  const { id, repoId, createdAt: _c, createdBy, ...rule } = r
  void id
  void repoId
  void _c
  let started = 0
  for (const ref of refs.slice(0, 3)) {
    const made = await createBuild({ repoId: r.repoId, ruleId, trigger: "schedule", ref: ref.name, commit: ref.commit, createdBy, spec: { rule, source: src.kind, refType: ref.type } })
    if (made.id) started++
  }
  return { started }
}

// A runner that starts again found these still marked as going: they died with the old one.
export async function recover() {
  const dead = await db
    .update(registryBuilds)
    .set({ status: "failed", reason: "The build runner restarted while this was running.", finishedAt: new Date() })
    .where(inArray(registryBuilds.status, ["running", "waiting"]))
    .returning({ id: registryBuilds.id })
  for (const d of dead) await publish(d.id, { status: "failed", reason: "The build runner restarted while this was running." })
  return { recovered: dead.length }
}

// ---- finishing -------------------------------------------------------------------------------------------------

const KEEP = 50

export async function finish(buildId: string, o: { status: "success" | "failed" | "cancelled" | "stopped"; reason: string | null; digest: string | null; log: string; tagged?: boolean }) {
  const row = await ctx(buildId)
  if (!row || !ACTIVE.includes(row.b.status)) return { ok: false }
  const { b, repo, ns } = row
  const name = `${ns.name}/${repo.name}`
  const key = `registry/build-logs/${buildId}.log`
  const stored = await putObject(key, Buffer.from(o.log), "text/plain; charset=utf-8").then(() => key, () => null)
  const tail = o.log.split("\n").slice(-200).join("\n")
  await db
    .update(registryBuilds)
    .set({ status: o.status, reason: o.reason, digest: o.digest, finishedAt: new Date(), logKey: stored, logTail: tail, ...(o.tagged === false && { tags: [] }) })
    .where(eq(registryBuilds.id, buildId))
  // The token the build pushed with.
  const tk = await redis.get(tokenKey(buildId)).catch(() => null)
  if (tk) await db.delete(registryTokens).where(eq(registryTokens.id, tk))
  await redis.del(tokenKey(buildId), `registry-build:cancel:${buildId}`).catch(() => {})
  await redis.expire(buildLogKey(buildId), 600).catch(() => {})
  await publish(buildId, { status: o.status, reason: o.reason })

  const spec = b.spec as unknown as Spec
  if (o.status === "success" && spec.tarKey) await removeObjects([spec.tarKey]).catch(() => {})
  await ghStatus(buildId, o.status === "success" ? "success" : o.status === "failed" ? "failure" : "error", o.status === "success" ? `Built ${name}` : (o.reason ?? o.status))

  // The bell: failures and stops always, a success only for builds someone started by hand.
  const manual = ["manual", "cli", "upload"].includes(b.trigger)
  if (o.status === "failed" || o.status === "stopped" || (o.status === "success" && manual)) {
    const to = b.createdBy ? [b.createdBy] : await namespaceOwners(ns.id)
    for (const id of to)
      await notify(id, "registry_build", { data: { name: `${name}${b.ref ? `@${b.ref}` : ""}`, status: o.status, reason: o.reason ?? "", href: `/registry/${name}?tab=builds&build=${buildId}` } })
  }
  await emit("build", repo.id, { repository: name, build: buildId, status: o.status, reason: o.reason, ref: b.ref, commit: b.commit, trigger: b.trigger, tags: o.status === "success" ? (await tagsOf(buildId)) : [], digest: o.digest, url: link(name, buildId) })
  const [u] = b.createdBy ? await db.select({ n: user.name }).from(user).where(eq(user.id, b.createdBy)) : []
  await logEvent({ namespaceId: ns.id, repoId: repo.id, actorId: b.createdBy, actorName: u?.n ?? "Nimbus", action: "build_finish", detail: { build: buildId, status: o.status, reason: o.reason, ref: b.ref, tags: await tagsOf(buildId) } })
  await prune(repo.id)
  return { ok: true }
}

const tagsOf = async (id: string) => (await db.select({ t: registryBuilds.tags }).from(registryBuilds).where(eq(registryBuilds.id, id)))[0]?.t ?? []

// The last 50 finished builds of a repo stay; older rows go with their logs and uploaded folders.
async function prune(repoId: string) {
  const old = await db
    .select({ id: registryBuilds.id, logKey: registryBuilds.logKey, spec: registryBuilds.spec })
    .from(registryBuilds)
    .where(and(eq(registryBuilds.repoId, repoId), notInArray(registryBuilds.status, ACTIVE as BuildStatus[])))
    .orderBy(desc(registryBuilds.createdAt))
    .offset(KEEP)
  if (!old.length) return
  await db.delete(registryBuilds).where(inArray(registryBuilds.id, old.map((o) => o.id)))
  await removeObjects(old.flatMap((o) => [o.logKey, (o.spec as Partial<Spec>).tarKey].filter((k): k is string => Boolean(k)))).catch(() => {})
}
