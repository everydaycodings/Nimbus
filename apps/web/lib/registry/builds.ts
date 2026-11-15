// Automated image builds: sources (GitHub, any git URL, uploads), rules, the build list, start, cancel and
// retry, the SSE log stream, cache numbers and the Health probe. The runner (scripts/registry-build.ts)
// does the actual building and calls back into lib/registry/build-ops.ts.
import "server-only"

import { randomBytes, randomUUID } from "node:crypto"
import net from "node:net"

import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm"

import { decrypt, encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { user } from "@/lib/db/auth-schema"
import { registryBuildRules, registryBuildSources, registryGitConnections, registryBuilds, registryManifests, registryNamespaces, registryRepos, settings } from "@/lib/db/schema"
import { appUrl } from "@/lib/email"
import { listen } from "@/lib/events"
import { guardVerdict, hostMetrics } from "@/lib/host-metrics"
import { buildsQueue, enqueueBuild, redis } from "@/lib/redis"
import { removeObjects, getText, putStream } from "@/lib/s3"
import { checkUrl, dialable } from "@/lib/secrets/webhooks"
import { getSettings } from "@/lib/signup"

import { repoRole, type Role } from "./access.ts"
import { logEvent } from "./activity.ts"
import { checkRefs } from "./build-secrets.ts"
import { createConnection, secretOf, sourceCredential, usable } from "./connections.ts"
import {
  PLATFORMS,
  buildCacheKey,
  buildCancelKey,
  buildHeartbeat,
  buildLogKey,
  buildChannel,
  expandTags,
  matchRule,
  validateRule,
  type RuleInput,
} from "./build-rules.ts"
import * as github from "./github.ts"
import { atLeast, validTag } from "./rules.ts"
import { scanReport, scanSummaries } from "./scan.ts"

export { PRESETS, expandTags, matchRule, validateRule, type RuleInput, type TagTemplate } from "./build-rules.ts"

export const BUILD_DEFAULTS = {
  concurrency: 1,
  timeoutMin: 60,
  preflightRamPct: 80,
  guardRamPct: 90,
  minDiskGb: 5,
  guardDiskGb: 2,
}

export type BuildStatus = "queued" | "waiting" | "running" | "success" | "failed" | "cancelled" | "stopped"
export type BuildTrigger = "push" | "tag" | "manual" | "schedule" | "cli" | "upload"
export const ACTIVE: BuildStatus[] = ["queued", "waiting", "running"]

export type BuildRow = {
  id: string
  repoId: string
  ruleId: string | null
  trigger: BuildTrigger
  ref: string | null
  commit: string | null
  status: BuildStatus
  reason: string | null
  tags: string[]
  digest: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  createdBy: string | null
  createdByName: string | null
  // Only in buildQueue(): "namespace/repo".
  repoName?: string
}

// What the runner needs, frozen when the build starts. No secret values.
export type Spec = {
  rule: RuleInput
  source: "github" | "git" | "upload"
  refType?: "branch" | "tag"
  tarKey?: string
}

export const subscribeChannel = buildChannel

export const MAX_CONTEXT_BYTES = 2 * 1024 ** 3
const MAX_WAITING = 20

// ---- availability and access ---------------------------------------------------------------------

export async function buildsAvailable(userId?: string): Promise<{ on: boolean; reason?: string }> {
  if (!process.env.BUILDKIT_HOST) return { on: false, reason: "Image builds aren't turned on for this server. An admin can turn them on in setup." }
  if (!(await getSettings()).registryBuilds) return { on: false, reason: "An admin turned image builds off." }
  if (userId) {
    const [u] = await db.select({ off: user.registryBuildsDisabled }).from(user).where(eq(user.id, userId))
    if (u?.off) return { on: false, reason: "Image builds are turned off for your account." }
  }
  return { on: true }
}

type Access = { repo: typeof registryRepos.$inferSelect; ns: typeof registryNamespaces.$inferSelect; full: string; role: Role }

async function access(userId: string, repoId: string, min: Role): Promise<Access | { error: string }> {
  const [row] = await db
    .select({ repo: registryRepos, ns: registryNamespaces })
    .from(registryRepos)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(and(eq(registryRepos.id, repoId), isNull(registryRepos.deletedAt)))
  if (!row) return { error: "That repository isn't here." }
  const role = await repoRole(userId, row.ns, row.repo)
  if (!role || !atLeast(role, min))
    return { error: min === "write" ? "You need write access to this repository to build it." : "Only repository admins and owners can change build settings." }
  return { ...row, full: `${row.ns.name}/${row.repo.name}`, role }
}

const publish = (id: string, msg: object) => redis.publish(`events:${buildChannel(id)}`, JSON.stringify(msg)).catch(() => {})

// ---- reading builds ---------------------------------------------------------------------------------

const cols = {
  id: registryBuilds.id,
  repoId: registryBuilds.repoId,
  ruleId: registryBuilds.ruleId,
  trigger: registryBuilds.trigger,
  ref: registryBuilds.ref,
  commit: registryBuilds.commit,
  status: registryBuilds.status,
  reason: registryBuilds.reason,
  tags: registryBuilds.tags,
  digest: registryBuilds.digest,
  createdAt: registryBuilds.createdAt,
  startedAt: registryBuilds.startedAt,
  finishedAt: registryBuilds.finishedAt,
  createdBy: registryBuilds.createdBy,
  createdByName: user.name,
}

export async function listBuilds(repoId: string, o: { limit?: number; before?: Date } = {}): Promise<BuildRow[]> {
  return db
    .select(cols)
    .from(registryBuilds)
    .leftJoin(user, eq(user.id, registryBuilds.createdBy))
    .where(and(eq(registryBuilds.repoId, repoId), o.before ? lt(registryBuilds.createdAt, o.before) : undefined))
    .orderBy(desc(registryBuilds.createdAt))
    .limit(Math.min(o.limit ?? 30, 100))
}

export async function getBuild(id: string): Promise<(BuildRow & { logTail: string; ruleSummary?: string }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [r] = await db
    .select({ ...cols, logTail: registryBuilds.logTail, spec: registryBuilds.spec })
    .from(registryBuilds)
    .leftJoin(user, eq(user.id, registryBuilds.createdBy))
    .where(eq(registryBuilds.id, id))
  if (!r) return null
  const { spec, ...row } = r
  const rule = (spec as Partial<Spec>).rule
  return { ...row, ruleSummary: rule ? `${rule.sourceType === "branch" ? "Branch" : "Tag"} ${rule.pattern} → ${rule.tags.join(", ")}` : undefined }
}

// The whole log: from storage once the build ended, else what the runner has said so far.
export async function buildLog(id: string): Promise<string> {
  const [b] = await db.select({ key: registryBuilds.logKey, tail: registryBuilds.logTail }).from(registryBuilds).where(eq(registryBuilds.id, id))
  if (!b) return ""
  if (b.key) return getText(b.key).catch(() => b.tail)
  const live = await redis.lrange(buildLogKey(id), 0, -1).catch(() => [] as string[])
  return live.length ? live.map((l) => (JSON.parse(l) as { t: string }).t).join("\n") : b.tail
}

// The queue across the server, for the admin page: what's running or waiting, oldest first.
export async function buildQueue(): Promise<BuildRow[]> {
  const rows = await db
    .select({ ...cols, ns: registryNamespaces.name, repoName: registryRepos.name })
    .from(registryBuilds)
    .leftJoin(user, eq(user.id, registryBuilds.createdBy))
    .innerJoin(registryRepos, eq(registryRepos.id, registryBuilds.repoId))
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(inArray(registryBuilds.status, ACTIVE))
    .orderBy(registryBuilds.createdAt)
  return rows.map(({ ns, repoName, ...r }) => ({ ...r, repoName: `${ns}/${repoName}` }))
}

// Server-sent events for one build: `line` {seq, text}, `status` {status, reason}, then `end`.
// A reconnect (Last-Event-ID or ?from=) continues after that line. Callers check access first.
export async function buildStream(req: Request, id: string): Promise<Response> {
  const enc = new TextEncoder()
  const from = Number(req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("from") ?? -1)
  let stop = () => {}
  const body = new ReadableStream({
    async start(controller) {
      let closed = false
      let last = Number.isFinite(from) ? from : -1
      const write = (s: string) => {
        try {
          controller.enqueue(enc.encode(s))
        } catch {
          stop()
        }
      }
      const line = (seq: number, text: string) => {
        if (seq <= last) return
        last = seq
        write(`id: ${seq}\nevent: line\ndata: ${JSON.stringify({ seq, text })}\n\n`)
      }
      const state = (status: BuildStatus, reason: string | null) => {
        write(`event: status\ndata: ${JSON.stringify({ status, reason })}\n\n`)
        if (!ACTIVE.includes(status)) {
          write("event: end\ndata: {}\n\n")
          stop()
        }
      }
      // Live messages wait until the backlog is out so nothing is dropped or doubled.
      const queued: string[] = []
      let backlogDone = false
      const handle = (raw: string) => {
        try {
          const m = JSON.parse(raw) as { s?: number; t?: string; status?: BuildStatus; reason?: string | null }
          if (m.status) state(m.status, m.reason ?? null)
          else if (m.s !== undefined) line(m.s, m.t ?? "")
        } catch {}
      }
      const off = listen(buildChannel(id), (raw) => (backlogDone ? handle(raw) : queued.push(raw)))
      const timer = setInterval(() => write(": ping\n\n"), 25_000)
      stop = () => {
        if (closed) return
        closed = true
        clearInterval(timer)
        off()
        try {
          controller.close()
        } catch {}
      }
      req.signal.addEventListener("abort", stop)
      write("retry: 5000\n\n")

      const b = await getBuild(id)
      if (!b) return stop()
      if (!ACTIVE.includes(b.status)) {
        // Finished: replay the stored log, then the result.
        const text = await buildLog(id)
        text.split("\n").forEach((t, i) => t && line(i, t))
        return state(b.status, b.reason)
      }
      const live = await redis.lrange(buildLogKey(id), 0, -1).catch(() => [] as string[])
      for (const l of live) handle(l)
      state(b.status, b.reason)
      backlogDone = true
      queued.forEach(handle)
      // It may have ended between the read and the subscribe.
      const again = await getBuild(id)
      if (again && again.status !== b.status) state(again.status, again.reason)
    },
    cancel: () => stop(),
  })
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" } })
}

// ---- sources ---------------------------------------------------------------------------------------------

export type Source = {
  kind: "github" | "git" | "upload"
  url: string | null
  hasCredential: boolean
  // The saved connection it uses; connectionLost: it was deleted and nothing replaced it yet.
  connection: { id: string; name: string; provider: string } | null
  connectionLost: boolean
  webhookUrl: string | null
  webhookSecretShownOnce?: never
  githubHookId: number | null
  lastDeliveryAt: Date | null
}

export async function getSource(repoId: string): Promise<Source | null> {
  const [s] = await db.select().from(registryBuildSources).where(eq(registryBuildSources.repoId, repoId))
  if (!s) return null
  const [c] = s.connectionId ? await db.select().from(registryGitConnections).where(eq(registryGitConnections.id, s.connectionId)) : []
  return {
    kind: s.kind,
    url: s.url,
    hasCredential: Boolean(s.credentialEnc || c),
    connection: c ? { id: c.id, name: c.name, provider: c.provider } : null,
    connectionLost: s.connectionLost,
    webhookUrl: s.kind === "upload" ? null : appUrl(`/api/registry/hooks/${s.kind}/${s.id}`),
    githubHookId: s.githubHookId,
    lastDeliveryAt: s.lastDeliveryAt,
  }
}

async function dropSource(repoId: string) {
  const [s] = await db.select().from(registryBuildSources).where(eq(registryBuildSources.repoId, repoId))
  if (!s) return
  if (s.kind === "github" && s.githubHookId && s.url) {
    const token = (await sourceCredential(s)).cred?.token
    if (token) await github.deleteHook(token, s.url, s.githubHookId).catch(() => {})
  }
  await db.delete(registryBuildSources).where(eq(registryBuildSources.id, s.id))
}

export async function listGithubRepos(token: string): Promise<github.GhRepo[] | { error: string }> {
  try {
    return await github.listRepos(token.trim())
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// The repo picker with a saved connection: the token stays on the server.
export async function listGithubReposFor(actorUserId: string, repoId: string, connectionId: string): Promise<github.GhRepo[] | { error: string }> {
  const c = await usable(actorUserId, repoId, connectionId, { kind: "github", url: "" })
  if ("error" in c) return c
  return listGithubRepos(secretOf(c))
}

// Either a saved connection, or a new secret that is saved as one (`save`) or kept on this source alone.
export type Save = { name: string; namespaceId: string }
export type GithubAuth = { connectionId: string } | { token: string; save?: Save }
export type GitAuth = { connectionId: string } | { username?: string; token?: string; sshKey?: string; save?: Save }

export async function connectGithub(actorUserId: string, repoId: string, v: { repo: string } & GithubAuth): Promise<{ error?: string }> {
  const a = await access(actorUserId, repoId, "admin")
  if ("error" in a) return a
  const full = github.parseFullName(v.repo)
  if (!full) return { error: "Pick a repository like owner/name." }
  let token: string
  let link: { connectionId: string } | { credentialEnc: string }
  if ("connectionId" in v) {
    const c = await usable(actorUserId, repoId, v.connectionId, { kind: "github", url: full })
    if ("error" in c) return c
    token = secretOf(c)
    link = { connectionId: c.id }
  } else {
    token = v.token.trim()
    if (!token) return { error: "Enter a GitHub token." }
    link = { credentialEnc: encrypt(token) }
  }
  const id = randomUUID()
  const secret = `ghs_${randomBytes(24).toString("base64url")}`
  try {
    await github.getRepo(token, full)
    if ("token" in v && v.save) {
      const made = await createConnection(actorUserId, { ...v.save, provider: "github", secret: token })
      if (!made.id) return { error: made.error }
      link = { connectionId: made.id }
    }
    await dropSource(repoId)
    await db.insert(registryBuildSources).values({ id, repoId, kind: "github", url: full, ...link, webhookSecretEnc: encrypt(secret) })
    const hookId = await github.createHook(token, full, appUrl(`/api/registry/hooks/github/${id}`), secret)
    await db.update(registryBuildSources).set({ githubHookId: hookId }).where(eq(registryBuildSources.id, id))
  } catch (e) {
    await db.delete(registryBuildSources).where(eq(registryBuildSources.id, id))
    const m = (e as Error).message
    return { error: /refused|admin/i.test(m) ? `${m} The token needs read access to the repository's code and write access to its webhooks.` : m }
  }
  await logEvent({ namespaceId: a.ns.id, repoId, actorId: actorUserId, actorName: await nameOf(actorUserId), action: "build_source", detail: { kind: "github", repo: full } })
  return {}
}

const SSH_URL = /^(?:ssh:\/\/)?[\w.-]+@[\w.-]+(?::|\/)[\w./~-]+$/

const hostOf = (url: string) => /^https?:\/\//i.test(url) ? new URL(url).host : (/@([\w.-]+)[:/]/.exec(url)?.[1] ?? "")

export async function connectGit(
  actorUserId: string,
  repoId: string,
  v: { url: string } & GitAuth
): Promise<{ error?: string; webhookUrl?: string; webhookSecret?: string }> {
  const a = await access(actorUserId, repoId, "admin")
  if ("error" in a) return a
  const url = v.url.trim()
  if (!url || url.length > 500 || url.startsWith("-")) return { error: "Enter the repository's clone URL." }
  if (/^https?:\/\//i.test(url)) {
    try {
      await dialable(checkUrl(url))
    } catch (e) {
      return { error: (e as Error).message }
    }
  } else if (!SSH_URL.test(url)) return { error: "Use an https:// or http:// URL, or an SSH address like git@host:owner/name.git." }
  let link: { connectionId: string } | { credentialEnc: string | null } = { credentialEnc: null }
  if ("connectionId" in v) {
    const c = await usable(actorUserId, repoId, v.connectionId, { kind: "git", url })
    if ("error" in c) return c
    link = { connectionId: c.id }
  } else {
    const sshKey = v.sshKey?.trim()
    const token = v.token?.trim()
    if (sshKey && (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(sshKey) || sshKey.length > 16_000)) return { error: "That doesn't look like an SSH private key." }
    if (sshKey && /^https?:/i.test(url)) return { error: "An SSH key goes with an SSH address, not an https:// URL." }
    if (token && !/^https?:/i.test(url)) return { error: "A token goes with an https:// URL. For an SSH address, use an SSH key." }
    if (token || sshKey) {
      if (v.save) {
        const made = await createConnection(actorUserId, { ...v.save, provider: sshKey ? "ssh" : "git", host: hostOf(url), username: v.username, secret: (sshKey ?? token)! })
        if (!made.id) return { error: made.error }
        link = { connectionId: made.id }
      } else link = { credentialEnc: encrypt(JSON.stringify({ username: v.username?.trim() || undefined, token: token || undefined, sshKey: sshKey ? `${sshKey}\n` : undefined })) }
    }
  }
  const secret = `whsec_${randomBytes(24).toString("base64url")}`
  await dropSource(repoId)
  const [s] = await db
    .insert(registryBuildSources)
    .values({ repoId, kind: "git", url, ...link, webhookSecretEnc: encrypt(secret) })
    .returning({ id: registryBuildSources.id })
  await logEvent({ namespaceId: a.ns.id, repoId, actorId: actorUserId, actorName: await nameOf(actorUserId), action: "build_source", detail: { kind: "git", url } })
  return { webhookUrl: appUrl(`/api/registry/hooks/git/${s.id}`), webhookSecret: secret }
}

// Switch a connected source to another saved connection. The repository, and so its webhook, stays.
export async function changeConnection(actorUserId: string, repoId: string, connectionId: string): Promise<{ error?: string }> {
  const a = await access(actorUserId, repoId, "admin")
  if ("error" in a) return a
  const [s] = await db.select().from(registryBuildSources).where(eq(registryBuildSources.repoId, repoId))
  if (!s || s.kind === "upload" || !s.url) return { error: "This repository has no GitHub or git source." }
  const c = await usable(actorUserId, repoId, connectionId, { kind: s.kind, url: s.url })
  if ("error" in c) return c
  if (s.kind === "github") {
    try {
      await github.getRepo(secretOf(c), s.url)
    } catch (e) {
      return { error: (e as Error).message }
    }
  }
  await db.update(registryBuildSources).set({ connectionId: c.id, credentialEnc: null, connectionLost: false }).where(eq(registryBuildSources.id, s.id))
  await logEvent({ namespaceId: a.ns.id, repoId, actorId: actorUserId, actorName: await nameOf(actorUserId), action: "connection", detail: { what: "use", name: c.name, provider: c.provider } })
  return {}
}

export async function useUploadsOnly(actorUserId: string, repoId: string): Promise<{ error?: string }> {
  const a = await access(actorUserId, repoId, "admin")
  if ("error" in a) return a
  await dropSource(repoId)
  await db.insert(registryBuildSources).values({ repoId, kind: "upload" })
  await logEvent({ namespaceId: a.ns.id, repoId, actorId: actorUserId, actorName: await nameOf(actorUserId), action: "build_source", detail: { kind: "upload" } })
  return {}
}

export async function disconnectSource(actorUserId: string, repoId: string): Promise<{ error?: string }> {
  const a = await access(actorUserId, repoId, "admin")
  if ("error" in a) return a
  await dropSource(repoId)
  await logEvent({ namespaceId: a.ns.id, repoId, actorId: actorUserId, actorName: await nameOf(actorUserId), action: "build_source", detail: { kind: null } })
  return {}
}

const nameOf = async (userId: string) => (await db.select({ n: user.name }).from(user).where(eq(user.id, userId)))[0]?.n ?? "A member"

// ---- rules ---------------------------------------------------------------------------------------------

export type RuleRow = RuleInput & { id: string; repoId: string; createdAt: Date }
const MAX_RULES = 20

export async function listRules(repoId: string): Promise<RuleRow[]> {
  const rows = await db.select().from(registryBuildRules).where(eq(registryBuildRules.repoId, repoId)).orderBy(registryBuildRules.createdAt)
  return rows.map((r) => ({
    id: r.id,
    repoId: r.repoId,
    createdAt: r.createdAt,
    sourceType: r.sourceType,
    pattern: r.pattern,
    tags: r.tags,
    dockerfile: r.dockerfile,
    context: r.context,
    buildArgs: r.buildArgs,
    secretRefs: r.secretRefs,
    platforms: r.platforms,
    failOnCritical: r.failOnCritical,
    schedule: r.schedule,
    enabled: r.enabled,
  }))
}

async function setSchedule(id: string, rule: { schedule: string | null; enabled: boolean }) {
  const key = `rule-${id}`
  if (rule.schedule && rule.enabled)
    await buildsQueue.upsertJobScheduler(key, { pattern: rule.schedule }, { name: "schedule", data: { ruleId: id }, opts: { removeOnComplete: true, removeOnFail: 20 } })
  else await buildsQueue.removeJobScheduler(key).catch(() => {})
}

export async function saveRule(actorUserId: string, repoId: string, ruleId: string | null, input: unknown): Promise<{ id?: string; error?: string }> {
  const a = await access(actorUserId, repoId, "admin")
  if ("error" in a) return a
  const { rule, error } = validateRule(input)
  if (!rule) return { error }
  const bad = await checkRefs(actorUserId, rule.secretRefs)
  if (bad) return { error: bad }
  const values = { ...rule, buildArgs: rule.buildArgs, secretRefs: rule.secretRefs }
  let id = ruleId
  if (id) {
    const done = await db.update(registryBuildRules).set(values).where(and(eq(registryBuildRules.id, id), eq(registryBuildRules.repoId, repoId))).returning({ id: registryBuildRules.id })
    if (!done.length) return { error: "That rule isn't here." }
  } else {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(registryBuildRules).where(eq(registryBuildRules.repoId, repoId))
    if (n >= MAX_RULES) return { error: `A repository can have at most ${MAX_RULES} build rules.` }
    ;[{ id }] = await db.insert(registryBuildRules).values({ ...values, repoId, createdBy: actorUserId }).returning({ id: registryBuildRules.id })
  }
  await setSchedule(id!, rule)
  await logEvent({ namespaceId: a.ns.id, repoId, actorId: actorUserId, actorName: await nameOf(actorUserId), action: "build_rule", detail: { rule: `${rule.sourceType} ${rule.pattern}`, created: !ruleId } })
  return { id: id! }
}

export async function deleteRule(actorUserId: string, ruleId: string): Promise<{ error?: string }> {
  const [r] = await db.select({ repoId: registryBuildRules.repoId, pattern: registryBuildRules.pattern }).from(registryBuildRules).where(eq(registryBuildRules.id, ruleId))
  if (!r) return { error: "That rule isn't here." }
  const a = await access(actorUserId, r.repoId, "admin")
  if ("error" in a) return a
  await db.delete(registryBuildRules).where(eq(registryBuildRules.id, ruleId))
  await setSchedule(ruleId, { schedule: null, enabled: false })
  await logEvent({ namespaceId: a.ns.id, repoId: r.repoId, actorId: actorUserId, actorName: await nameOf(actorUserId), action: "build_rule", detail: { rule: r.pattern, deleted: true } })
  return {}
}

// ---- starting, cancelling, retrying ------------------------------------------------------------------------

type NewBuild = { repoId: string; ruleId: string | null; trigger: BuildTrigger; ref: string | null; commit: string | null; createdBy: string | null; spec: Spec; tags?: string[] }

// Writes the row and queues it. A newer push replaces an older one still waiting for the same rule and ref.
export async function createBuild(v: NewBuild, o: { supersede?: boolean } = {}): Promise<{ id?: string; error?: string }> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(registryBuilds)
    .where(and(eq(registryBuilds.repoId, v.repoId), inArray(registryBuilds.status, ["queued", "waiting"])))
  if (n >= MAX_WAITING) return { error: "Too many builds are already waiting for this repository." }
  if (o.supersede && v.ruleId && v.ref) {
    const old = await db
      .select({ id: registryBuilds.id })
      .from(registryBuilds)
      .where(and(eq(registryBuilds.ruleId, v.ruleId), eq(registryBuilds.ref, v.ref), eq(registryBuilds.status, "queued")))
    for (const b of old) await endQueued(b.id, "cancelled", "Replaced by a newer push")
  }
  const tags = v.tags ?? (v.commit ? tagsFor(v.spec, v.ref, v.commit) : [])
  const [b] = await db
    .insert(registryBuilds)
    .values({ repoId: v.repoId, ruleId: v.ruleId, trigger: v.trigger, ref: v.ref, commit: v.commit, createdBy: v.createdBy, spec: v.spec, tags })
    .returning({ id: registryBuilds.id })
  try {
    await enqueueBuild(b.id)
  } catch {
    await db.update(registryBuilds).set({ status: "failed", reason: "The build queue (Redis) isn't reachable.", finishedAt: new Date() }).where(eq(registryBuilds.id, b.id))
    return { error: "The build queue (Redis) isn't reachable." }
  }
  await publish(b.id, { status: "queued", reason: null })
  return { id: b.id }
}

export function tagsFor(spec: Spec, ref: string | null, commit: string) {
  return expandTags(spec.rule.tags, { sha: commit, ...(spec.refType === "tag" ? { tag: ref ?? undefined } : { branch: ref ?? undefined }) })
}

// A queued build that never ran: ends it without the runner.
async function endQueued(id: string, status: "cancelled" | "failed", reason: string) {
  const done = await db
    .update(registryBuilds)
    .set({ status, reason, finishedAt: new Date() })
    .where(and(eq(registryBuilds.id, id), eq(registryBuilds.status, "queued")))
    .returning({ id: registryBuilds.id })
  if (!done.length) return
  const job = await buildsQueue.getJob(id).catch(() => null)
  await job?.remove().catch(() => {})
  await publish(id, { status, reason })
}

const literal = (p: string) => !p.startsWith("re:") && !/[*?,]/.test(p)

export async function startBuild(
  actorUserId: string,
  repoId: string,
  o: { ruleId?: string; ref?: { type: "branch" | "tag"; name: string } }
): Promise<{ id?: string; error?: string }> {
  const a = await access(actorUserId, repoId, "write")
  if ("error" in a) return a
  if (a.repo.archivedAt) return { error: "This repository is archived." }
  const av = await buildsAvailable(actorUserId)
  if (!av.on) return { error: av.reason }
  const src = await getSource(repoId)
  if (!src || src.kind === "upload") return { error: "Connect a GitHub repository or a git URL first, or upload a folder." }
  const rules = (await listRules(repoId)).filter((r) => r.enabled)
  let rule = o.ruleId ? rules.find((r) => r.id === o.ruleId) : undefined
  if (o.ruleId && !rule) return { error: "That rule isn't here or is turned off." }
  let ref = o.ref
  if (!ref && rule && literal(rule.pattern)) ref = { type: rule.sourceType, name: rule.pattern }
  if (!ref) return { error: "Pick the branch or tag to build." }
  if (!/^[\w./@+-]{1,200}$/.test(ref.name) || ref.name.startsWith("-")) return { error: "That isn't a valid branch or tag name." }
  rule ??= rules.find((r) => matchRule(r, ref!))
  if (!rule) return { error: `No build rule matches ${ref.name}. Add a rule first.` }
  const r = await createBuild({
    repoId,
    ruleId: rule.id,
    trigger: "manual",
    ref: ref.name,
    commit: null,
    createdBy: actorUserId,
    spec: { rule: stripRule(rule), source: src.kind, refType: ref.type },
  })
  if (r.id) await logEvent({ namespaceId: a.ns.id, repoId, actorId: actorUserId, actorName: await nameOf(actorUserId), action: "build_start", detail: { build: r.id, ref: ref.name, trigger: "manual" } })
  return r
}

const stripRule = (r: RuleInput): RuleInput => ({
  sourceType: r.sourceType,
  pattern: r.pattern,
  tags: r.tags,
  dockerfile: r.dockerfile,
  context: r.context,
  buildArgs: r.buildArgs,
  secretRefs: r.secretRefs,
  platforms: r.platforms,
  failOnCritical: r.failOnCritical,
  schedule: r.schedule,
  enabled: r.enabled,
})

// Called by the hook routes. Returns how many builds it started.
export async function triggerRef(
  sourceId: string,
  ref: { type: "branch" | "tag"; name: string },
  commit: string | null
): Promise<{ started: number; reason?: string }> {
  const [s] = await db.select().from(registryBuildSources).where(eq(registryBuildSources.id, sourceId))
  if (!s || s.kind === "upload") return { started: 0 }
  const [repo] = await db.select({ archivedAt: registryRepos.archivedAt, deletedAt: registryRepos.deletedAt }).from(registryRepos).where(eq(registryRepos.id, s.repoId))
  if (!repo || repo.deletedAt || repo.archivedAt) return { started: 0, reason: "The repository is archived or gone." }
  if (!(await buildsAvailable()).on) return { started: 0, reason: "Builds are off." }
  let started = 0
  for (const rule of (await listRules(s.repoId)).filter((r) => r.enabled && matchRule(r, ref))) {
    const r = await createBuild(
      { repoId: s.repoId, ruleId: rule.id, trigger: ref.type === "tag" ? "tag" : "push", ref: ref.name, commit, createdBy: null, spec: { rule: stripRule(rule), source: s.kind, refType: ref.type } },
      { supersede: true }
    )
    if (r.id) started++
  }
  return { started }
}

export async function recordDelivery(sourceId: string) {
  await db.update(registryBuildSources).set({ lastDeliveryAt: new Date() }).where(eq(registryBuildSources.id, sourceId))
}

export async function sourceById(sourceId: string, kind: "github" | "git") {
  if (!/^[0-9a-f-]{36}$/i.test(sourceId)) return null
  const [s] = await db.select().from(registryBuildSources).where(and(eq(registryBuildSources.id, sourceId), eq(registryBuildSources.kind, kind)))
  const secret = s?.webhookSecretEnc ? decrypt(s.webhookSecretEnc) : null
  return s && secret ? { id: s.id, repoId: s.repoId, secret } : null
}

// Browser or CLI upload of a build context (tar, tar.gz or zip): streamed into storage, 2 GB at most.
export async function stageUpload(body: ReadableStream<Uint8Array> | File): Promise<{ tarKey?: string; bytes?: number; error?: string }> {
  const key = `registry/build-contexts/${randomUUID()}`
  let bytes = 0
  const input = body instanceof File ? body.stream() : body
  const counted = input.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        bytes += chunk.byteLength
        if (bytes > MAX_CONTEXT_BYTES) c.error(new Error("too-large"))
        else c.enqueue(chunk)
      },
    })
  )
  try {
    await putStream(key, counted, "application/octet-stream")
  } catch (e) {
    await removeObjects([key]).catch(() => {})
    return { error: (e as Error).message.includes("too-large") ? "That folder is over 2 GB. Add a .dockerignore." : "The upload didn't finish." }
  }
  if (!bytes) {
    await removeObjects([key]).catch(() => {})
    return { error: "The upload was empty." }
  }
  return { tarKey: key, bytes }
}

export async function startUploadBuild(
  actorUserId: string,
  repoId: string,
  o: { tarKey: string; tags: string[]; platforms?: string[]; buildArgs?: { key: string; value: string }[]; dockerfile?: string },
  trigger: "cli" | "upload" = "upload"
): Promise<{ id?: string; error?: string }> {
  const a = await access(actorUserId, repoId, "write")
  if ("error" in a) return a
  if (a.repo.archivedAt) return { error: "This repository is archived." }
  const av = await buildsAvailable(actorUserId)
  if (!av.on) return { error: av.reason }
  if (!o.tarKey.startsWith("registry/build-contexts/")) return { error: "Unknown upload." }
  const tags = [...new Set(o.tags)]
  if (!tags.length || tags.length > 10 || !tags.every(validTag)) return { error: "Give 1 to 10 valid image tags." }
  const platforms = o.platforms ?? []
  if (platforms.length > 4 || platforms.some((p) => !PLATFORMS.includes(p))) return { error: `Platforms can be ${PLATFORMS.join(", ")}.` }
  // Reuse the rule checks for the rest, with tags as plain templates.
  const { rule, error } = validateRule({ sourceType: "branch", pattern: "*", tags, dockerfile: o.dockerfile, buildArgs: o.buildArgs ?? [], platforms })
  if (!rule) return { error }
  const r = await createBuild({ repoId, ruleId: null, trigger, ref: null, commit: null, createdBy: actorUserId, spec: { rule: { ...rule, tags }, source: "upload", tarKey: o.tarKey }, tags })
  if (r.id) await logEvent({ namespaceId: a.ns.id, repoId, actorId: actorUserId, actorName: await nameOf(actorUserId), action: "build_start", detail: { build: r.id, trigger, tags } })
  return r
}


export async function cancelBuild(actorUserId: string, id: string): Promise<{ error?: string }> {
  const b = await getBuild(id)
  if (!b) return { error: "That build isn't here." }
  const a = await access(actorUserId, b.repoId, "write")
  if ("error" in a) return a
  if (!ACTIVE.includes(b.status)) return { error: "That build has already finished." }
  const who = await nameOf(actorUserId)
  await redis.set(buildCancelKey(id), who, "EX", 3600)
  // Not started yet: end it here. A running one is stopped by the runner within a couple of seconds.
  await endQueued(id, "cancelled", `Cancelled by ${who}`)
  await logEvent({ namespaceId: a.ns.id, repoId: b.repoId, actorId: actorUserId, actorName: who, action: "build_cancel", detail: { build: id } })
  return {}
}

export async function retryBuild(actorUserId: string, id: string): Promise<{ id?: string; error?: string }> {
  const [b] = await db.select().from(registryBuilds).where(eq(registryBuilds.id, id))
  if (!b) return { error: "That build isn't here." }
  const a = await access(actorUserId, b.repoId, "write")
  if ("error" in a) return a
  if (ACTIVE.includes(b.status)) return { error: "That build is still going." }
  if (a.repo.archivedAt) return { error: "This repository is archived." }
  const av = await buildsAvailable(actorUserId)
  if (!av.on) return { error: av.reason }
  const spec = b.spec as unknown as Spec
  if (!spec.rule) return { error: "That build can't be retried; start a new one." }
  if (spec.tarKey && !(await getText(spec.tarKey).then(() => true, () => false))) return { error: "The uploaded folder is gone. Upload it again." }
  const r = await createBuild({ repoId: b.repoId, ruleId: b.ruleId, trigger: b.trigger === "schedule" || b.trigger === "push" || b.trigger === "tag" ? "manual" : b.trigger, ref: b.ref, commit: b.commit, createdBy: actorUserId, spec })
  if (r.id) await logEvent({ namespaceId: a.ns.id, repoId: b.repoId, actorId: actorUserId, actorName: await nameOf(actorUserId), action: "build_start", detail: { build: r.id, retryOf: id } })
  return r
}

// ---- cache, signing key, health ----------------------------------------------------------------------------------


// Size of BuildKit's cache volume, as the runner last measured it (buildctl du); null when it hasn't.
export async function cacheUsage(): Promise<{ bytes: number } | null> {
  try {
    const raw = await redis.get(buildCacheKey)
    return raw ? { bytes: (JSON.parse(raw) as { bytes: number }).bytes } : null
  } catch {
    return null
  }
}

// Asks the runner to run `buildctl prune` and waits for the answer (up to 2 minutes).
export async function pruneCache(): Promise<{ freed: number }> {
  if (!process.env.BUILDKIT_HOST) throw new Error("Image builds aren't turned on.")
  const id = randomUUID()
  await buildsQueue.add("prune", { id }, { jobId: `prune-${id}`, attempts: 1, removeOnComplete: true, removeOnFail: 5 })
  for (let i = 0; i < 120; i++) {
    const r = await redis.get(`registry:build:prune:${id}`).catch(() => null)
    if (r) {
      await redis.del(`registry:build:prune:${id}`).catch(() => {})
      const j = JSON.parse(r) as { freed?: number; error?: string }
      if (j.error) throw new Error(j.error)
      return { freed: j.freed ?? 0 }
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error("The build runner didn't answer. Is it running?")
}

// The public half of the server's cosign key (null until the runner has made it): `cosign verify --key`.
export async function cosignPublicKey(): Promise<string | null> {
  const [s] = await db.select({ pub: settings.registryCosignPub }).from(settings)
  return s?.pub ?? null
}

// For the Health probe: BuildKit reachable, the runner alive, guard stops, and numbers worth a bell.
export async function buildsHealth(s: { registryBuilds: boolean }): Promise<{ detail: string; off?: boolean; slow?: true; warn?: string }> {
  const host = process.env.BUILDKIT_HOST
  if (!host) return { detail: "Image builds aren't turned on (setup).", off: true }
  if (!s.registryBuilds) return { detail: "Image builds are turned off.", off: true }
  const u = new URL(host.replace(/^tcp:/, "http:"))
  await new Promise<void>((resolve, reject) => {
    const sock = net.connect({ host: u.hostname, port: Number(u.port) || 1234, timeout: 3000 }, () => {
      sock.destroy()
      resolve()
    })
    sock.on("timeout", () => (sock.destroy(), reject(new Error(`No answer from BuildKit at ${u.host}.`))))
    sock.on("error", () => reject(new Error(`Couldn't reach BuildKit at ${u.host}.`)))
  })
  if (!(await redis.get(buildHeartbeat).catch(() => null))) throw new Error("The build runner isn't running (no heartbeat). BuildKit is reachable.")
  const m = await hostMetrics()
  const [{ stops }] = await db
    .select({ stops: sql<number>`count(*)::int` })
    .from(registryBuilds)
    .where(and(eq(registryBuilds.status, "stopped"), sql`${registryBuilds.finishedAt} > now() - interval '24 hours'`))
  const cache = await cacheUsage()
  const limit = (Number(process.env.BUILD_CACHE_GB) || 10) * 1024 ** 3
  const gb = (n: number) => (n / 1024 ** 3).toFixed(1)
  const detail = [
    `BuildKit reachable. RAM ${m.memUsedPct}%, load ${m.load1.toFixed(1)} of ${m.cores} cores`,
    ...m.disk.map((d) => `${d.path} ${gb(d.free)} GB free`),
    cache ? `cache ${gb(cache.bytes)} of ${gb(limit)} GB` : null,
    stops ? `${stops} build${stops === 1 ? "" : "s"} stopped by the guard in the last 24 h` : null,
  ]
    .filter(Boolean)
    .join(", ")
  const warn = stops >= 3 ? `${stops} builds were stopped to protect the server in 24 hours.` : cache && cache.bytes > 0.8 * limit ? `The build cache is ${gb(cache.bytes)} of ${gb(limit)} GB. Clean it in Registry settings.` : undefined
  return { detail: `${detail}.`, ...(stops && { slow: true as const }), warn }
}

// ---- what a build would meet right now, and what a failed scan found -----------------------------------------

export type Outlook = { mem: string; cpus: string; timeoutMin: number; memPct: number; wait: string | null; ahead: number }

// For the Build now dialog and the rule editor: the caps a build runs under, the server's load, and whether a
// build started now would wait (same checks as the runner's pre-flight) or stand in line.
export async function buildOutlook(): Promise<Outlook> {
  const [s, m, [{ n }]] = await Promise.all([
    getSettings(),
    hostMetrics(),
    db.select({ n: sql<number>`count(*)::int` }).from(registryBuilds).where(inArray(registryBuilds.status, ACTIVE)),
  ])
  const v = guardVerdict(m, { ramPct: s.registryBuildPreflightRamPct, minDiskGb: s.registryBuildMinDiskGb, loadFactor: 1.5 })
  const slots = Math.max(1, s.registryBuildConcurrency)
  return {
    mem: process.env.BUILD_MEM || "2g",
    cpus: process.env.BUILD_CPUS || "1",
    timeoutMin: s.registryBuildTimeoutMin,
    memPct: m.memUsedPct,
    wait: v.ok ? null : (v.reason ?? "busy"),
    // Builds in line beyond the free slots; 0 means a slot is open.
    ahead: Math.max(0, n - slots + 1),
  }
}

// The Critical and High findings of the image a failed build pushed (the scan gate keeps it untagged, so look it up by digest).
export async function buildFindings(repoId: string, digest: string) {
  const [m] = await db
    .select({ id: registryManifests.id })
    .from(registryManifests)
    .where(and(eq(registryManifests.repoId, repoId), eq(registryManifests.digest, digest), isNull(registryManifests.deletedAt)))
  if (!m) return null
  const [sum, rep] = await Promise.all([scanSummaries([m.id]), scanReport(m.id)])
  const s = sum[m.id]
  if (!s) return null
  return {
    summary: { status: s.status, critical: s.critical, high: s.high, medium: s.medium, low: s.low },
    vulns: (rep?.vulns ?? []).filter((v) => /^(critical|high)$/i.test(v.severity)),
    error: rep?.error ?? null,
  }
}

// The newest successful build with a digest, optionally the one before `before`: for the cosign example and "bigger than last time".
export async function lastSuccess(repoId: string, before?: Date) {
  const [r] = await db
    .select({ tags: registryBuilds.tags, digest: registryBuilds.digest })
    .from(registryBuilds)
    .where(and(eq(registryBuilds.repoId, repoId), eq(registryBuilds.status, "success"), sql`${registryBuilds.digest} is not null`, before ? lt(registryBuilds.createdAt, before) : undefined))
    .orderBy(desc(registryBuilds.createdAt))
    .limit(1)
  return r ?? null
}

// ---- status badge token (private repositories) ---------------------------------------------------------------------

export async function badgeToken(repoId: string): Promise<string | null> {
  const [r] = await db.select({ t: registryRepos.badgeToken }).from(registryRepos).where(eq(registryRepos.id, repoId))
  return r?.t ?? null
}

// Makes the secret in a private repository's badge URL; the old URL stops working.
export async function newBadgeToken(actorUserId: string, repoId: string): Promise<{ token?: string; error?: string }> {
  const a = await access(actorUserId, repoId, "admin")
  if ("error" in a) return a
  const token = randomBytes(18).toString("base64url")
  await db.update(registryRepos).set({ badgeToken: token }).where(eq(registryRepos.id, repoId))
  return { token }
}
