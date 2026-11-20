// Registry Cleanup & Mirror (/more/registry-tools): the member's own cleanup rules and upstream mirrors,
// their runs and the minute tick. A rule is a cleanup Policy (policy.ts shares the selection with its dry run,
// so the preview lists exactly what the run removes); a mirror run is queued for the worker (tools-mirror.ts).
import "server-only"

import { and, desc, eq, lt, sql } from "drizzle-orm"

import { encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { registryMirrors, registryRepos, registryRules, registryToolRuns, settings } from "@/lib/db/schema"
import { notify } from "@/lib/notify"
import { enqueueRegistryMirror } from "@/lib/redis"

import { createRepoOnPush, resolveRepo } from "./access.ts"
import { runGc } from "./gc.ts"
import { listRepos, type RepoRow } from "./manage.ts"
import { applyPolicy, previewPolicy } from "./policy.ts"
import { atLeast, matchPattern, splitName, type Policy } from "./rules.ts"
import { MIN_INTERVAL, MIRROR_CAP_MAX, validRegex } from "./tools-rules.ts"
import { checkUpstream, syncMirror } from "./tools-mirror.ts"

type Rule = typeof registryRules.$inferSelect
type Mirror = typeof registryMirrors.$inferSelect
type Result = { error?: string }

const MAX_ITEMS = 50
const iso = (d: Date | null) => (d ? d.toISOString() : null)

// Repos the member can delete from: owner or admin of the namespace or repo, not archived.
export async function manageable(userId: string): Promise<RepoRow[]> {
  return (await listRepos(userId)).filter((r) => atLeast(r.role, "admin") && !r.archived)
}

const whole = (v: unknown, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null
}

// ---- Rules ----------------------------------------------------------------

export type RuleInput = {
  name?: string
  repoId?: string | null
  pattern?: string | null
  keepLast?: number | null
  olderThanDays?: number | null
  keepRegex?: string | null
  deleteUntagged?: boolean
  intervalMin?: number
  enabled?: boolean
}

type RuleValues = Omit<typeof registryRules.$inferInsert, "userId" | "id">

async function parseRule(userId: string, i: RuleInput): Promise<{ value: RuleValues } | { error: string }> {
  const repos = await manageable(userId)
  const pattern = i.pattern?.trim() || null
  const repo = i.repoId ? repos.find((r) => r.id === i.repoId) : null
  if (i.repoId && !repo) return { error: "You can only clean up repos you own or administer." }
  if (!repo && !pattern) return { error: "Choose a repo or enter a name pattern." }
  if (repo && pattern) return { error: "Use either one repo or a pattern." }
  if (pattern && (pattern.length > 200 || pattern.startsWith("re:"))) return { error: "Use a glob like myteam/* for the repos." }
  const keepRegex = i.keepRegex?.trim() || null
  const bad = keepRegex && validRegex(keepRegex)
  if (bad) return { error: bad }
  const keepLast = whole(i.keepLast, 1, 1000)
  const olderThanDays = whole(i.olderThanDays, 1, 3650)
  if (!keepLast && !olderThanDays && !i.deleteUntagged) return { error: "Choose what to remove: older tags, tags beyond the newest N, or untagged images." }
  const intervalMin = whole(i.intervalMin ?? 1440, MIN_INTERVAL, 525_600) ?? 1440
  return {
    value: {
      name: (i.name?.trim() || (repo ? `Clean up ${repo.fullName}` : `Clean up ${pattern}`)).slice(0, 60),
      repoId: repo?.id ?? null,
      pattern: repo ? null : pattern,
      keepLast,
      olderThanDays,
      keepRegex,
      deleteUntagged: Boolean(i.deleteUntagged),
      intervalMin,
      enabled: i.enabled ?? true,
    },
  }
}

const policyOf = (r: Pick<RuleValues, "keepLast" | "olderThanDays" | "keepRegex" | "deleteUntagged">): Policy => ({
  ...(r.keepLast && { keepLast: r.keepLast }),
  ...(r.olderThanDays && { olderThanDays: r.olderThanDays }),
  ...(r.keepRegex && { keepRegex: r.keepRegex }),
  ...(r.deleteUntagged && { untaggedDays: 1 }),
})

// The repos a rule reaches now, by the member's current rights.
async function scope(userId: string, r: Pick<RuleValues, "repoId" | "pattern">) {
  const repos = await manageable(userId)
  return r.repoId ? repos.filter((x) => x.id === r.repoId) : repos.filter((x) => matchPattern(r.pattern ?? "", x.fullName))
}

const list = (xs: string[]) => (xs.length ? sql.join(xs.map((x) => sql`${x}`), sql`, `) : sql`null`)

// Blobs only these manifests use: what garbage collection frees once they've left Trash (the tag of a
// removed manifest's index children included). A blob another image or repo still uses stays.
async function freedBytes(repoId: string, tags: string[], untagged: string[]) {
  if (!tags.length && !untagged.length) return 0
  const [r] = await db.execute<{ s: string }>(sql`
    with gone as (
      select m.id from registry_manifests m
      where m.repo_id = ${repoId} and m.deleted_at is null and (
        m.digest in (${list(untagged)})
        or (m.digest in (select t.digest from registry_tags t where t.repo_id = ${repoId} and t.deleted_at is null and t.name in (${list(tags)}))
          and not exists (select 1 from registry_tags t where t.repo_id = m.repo_id and t.deleted_at is null and t.digest = m.digest and t.name not in (${list(tags)}))))
    ), kids as (
      select m.id from registry_manifests m
      where m.repo_id = ${repoId} and m.deleted_at is null and m.id not in (select id from gone)
        and exists (select 1 from registry_manifest_refs r join gone g on g.id = r.manifest_id where r.kind = 'manifest' and r.digest = m.digest)
        and not exists (select 1 from registry_tags t where t.repo_id = m.repo_id and t.deleted_at is null and t.digest = m.digest)
        and not exists (select 1 from registry_manifest_refs r join registry_manifests p on p.id = r.manifest_id
          where r.kind = 'manifest' and r.digest = m.digest and p.repo_id = m.repo_id and p.deleted_at is null and p.id not in (select id from gone))
    ), dead as (select id from gone union select id from kids)
    select coalesce(sum(b.size), 0)::text as s from registry_blobs b
    where b.digest in (select r.digest from registry_manifest_refs r where r.kind = 'blob' and r.manifest_id in (select id from dead))
      and not exists (select 1 from registry_manifest_refs r2 join registry_manifests m2 on m2.id = r2.manifest_id
        where r2.kind = 'blob' and r2.digest = b.digest and m2.deleted_at is null and m2.id not in (select id from dead))`)
  return Number(r?.s ?? 0)
}

export type Preview = {
  scanned: number
  repos: { repo: string; tags: string[]; manifests: string[]; bytes: number }[]
  tags: number
  manifests: number
  bytes: number
}

// Nothing is deleted. The same selection the run makes (previewPolicy is what applyPolicy uses).
export async function dryRun(userId: string, input: RuleInput): Promise<Preview | { error: string }> {
  const v = await parseRule(userId, input)
  if ("error" in v) return v
  const repos = await scope(userId, v.value)
  const out: Preview = { scanned: repos.length, repos: [], tags: 0, manifests: 0, bytes: 0 }
  for (const r of repos) {
    const sel = await previewPolicy(r.id, policyOf(v.value))
    if (!sel.tags.length && !sel.untagged.length) continue
    const bytes = await freedBytes(r.id, sel.tags, sel.untagged)
    out.repos.push({ repo: r.fullName, tags: sel.tags, manifests: sel.untagged, bytes })
    out.tags += sel.tags.length
    out.manifests += sel.untagged.length
    out.bytes += bytes
  }
  return out
}

async function countMine(table: typeof registryRules | typeof registryMirrors, userId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.userId, userId))
  return n
}

export async function saveRule(userId: string, id: string | null, input: RuleInput): Promise<Result & { id?: string }> {
  const v = await parseRule(userId, input)
  if ("error" in v) return v
  if (id) {
    const [r] = await db.update(registryRules).set({ ...v.value, nextDueAt: new Date() }).where(and(eq(registryRules.id, id), eq(registryRules.userId, userId))).returning({ id: registryRules.id })
    return r ? { id: r.id } : { error: "That rule is gone." }
  }
  if ((await countMine(registryRules, userId)) >= MAX_ITEMS) return { error: `You can have ${MAX_ITEMS} rules.` }
  const [r] = await db.insert(registryRules).values({ userId, ...v.value }).returning({ id: registryRules.id })
  return { id: r.id }
}

export async function deleteRule(userId: string, id: string): Promise<Result> {
  await db.delete(registryRules).where(and(eq(registryRules.id, id), eq(registryRules.userId, userId)))
  return {}
}

export async function setRuleEnabled(userId: string, id: string, enabled: boolean): Promise<Result> {
  await db.update(registryRules).set({ enabled, ...(enabled && { nextDueAt: new Date() }) }).where(and(eq(registryRules.id, id), eq(registryRules.userId, userId)))
  return {}
}

// After a run: streak, next due time and the alert (bell + email) at two failures in a row, claimed first so a retry doesn't send it twice.
async function settle(table: "registry_rules" | "registry_mirrors", row: { id: string; userId: string; name: string; failStreak: number; alertedAt: Date | null }, error?: string) {
  const streak = error ? row.failStreak + 1 : 0
  await db.execute(sql`update ${sql.raw(table)} set last_run_at = now(), last_status = ${error ? "failed" : "ok"}, fail_streak = ${streak},
    next_due_at = now() + make_interval(mins => interval_min)${error ? sql`` : sql`, alerted_at = null`} where id = ${row.id}`)
  if (streak < 2 || row.alertedAt) return
  const claimed = await db.execute(sql`update ${sql.raw(table)} set alerted_at = now() where id = ${row.id} and alerted_at is null returning id`)
  if (claimed.length)
    await notify(row.userId, "registry_mirror", {
      data: { event: "failed", what: table === "registry_rules" ? "cleanup rule" : "mirror", name: row.name, streak: String(streak), error: error ?? "", href: "/more/registry-tools?tab=history" },
    })
}

// Applies the rule (tags and untagged images go to Trash, restorable for 7 days), then collects garbage.
export async function runRule(rule: Rule, trigger: "schedule" | "manual"): Promise<Result & { removed?: number }> {
  const [run] = await db.insert(registryToolRuns).values({ userId: rule.userId, kind: "rule", refId: rule.id, label: rule.name, trigger }).onConflictDoNothing().returning({ id: registryToolRuns.id })
  if (!run) return { error: "This rule is already running." }
  const lines: string[] = []
  let changed = 0
  let bytes = 0
  let error: string | undefined
  try {
    for (const r of await scope(rule.userId, rule)) {
      const done = await applyPolicy(r.id, policyOf(rule))
      if (!done.tags.length && !done.untagged.length) continue
      changed += done.tags.length + done.untagged.length
      lines.push(`${r.fullName}: ${done.tags.length} tag${done.tags.length === 1 ? "" : "s"}, ${done.untagged.length} untagged image${done.untagged.length === 1 ? "" : "s"}`)
    }
    const gc = await runGc()
    bytes = gc.bytes
    lines.push(`Garbage collection freed ${gc.blobs} blob${gc.blobs === 1 ? "" : "s"}`)
  } catch (e) {
    error = (e as Error).message || "The run failed."
  }
  await db.update(registryToolRuns).set({ status: error ? "failed" : "ok", changed, bytes, lines, error: error ?? null, finishedAt: new Date() }).where(eq(registryToolRuns.id, run.id))
  await settle("registry_rules", rule, error)
  return error ? { error } : { removed: changed }
}

export async function runRuleNow(userId: string, id: string) {
  const [rule] = await db.select().from(registryRules).where(and(eq(registryRules.id, id), eq(registryRules.userId, userId)))
  return rule ? runRule(rule, "manual") : { error: "That rule is gone." }
}

// ---- Mirrors ----------------------------------------------------------------

export type MirrorInput = {
  name?: string
  upstream: string
  tags?: string
  cap?: number | null
  target: string
  username?: string | null
  // Blank keeps the saved one when editing.
  password?: string | null
  clearPassword?: boolean
  intervalMin?: number
  enabled?: boolean
}

export async function saveMirror(userId: string, id: string | null, i: MirrorInput): Promise<Result & { id?: string; password?: string }> {
  const up = await checkUpstream(i.upstream)
  if ("error" in up) return up
  const tags = (i.tags ?? "").trim() || "latest"
  if (tags.length > 300) return { error: "That's a long tag list. Use a pattern like 3.* instead." }
  const target = i.target.trim()
  if (!splitName(target)) return { error: "Enter the target repo as namespace/name." }
  // A repo that doesn't exist yet is made, in a namespace the member can push to.
  let found = await resolveRepo(target)
  found ??= await createRepoOnPush({ userId, tokenId: null, access: "delete", allRepos: true, repoIds: [] }, target, "web")
  const repo = found && (await manageable(userId)).find((r) => r.id === found.repo.id)
  if (!repo) return { error: "You can only mirror into repos you own or administer, in your own or an org's registry." }
  const password = i.password?.trim() || null
  const value = {
    name: (i.name?.trim() || `Mirror ${up.path}`).slice(0, 60),
    upstream: i.upstream.trim(),
    tags,
    cap: whole(i.cap ?? 5, 1, MIRROR_CAP_MAX) ?? 5,
    targetRepoId: repo.id,
    username: i.username?.trim() || null,
    ...(i.clearPassword ? { passwordEnc: null } : password ? { passwordEnc: encrypt(password) } : {}),
    intervalMin: whole(i.intervalMin ?? 1440, MIN_INTERVAL, 525_600) ?? 1440,
    enabled: i.enabled ?? true,
  }
  if (id) {
    const [m] = await db.update(registryMirrors).set({ ...value, nextDueAt: new Date() }).where(and(eq(registryMirrors.id, id), eq(registryMirrors.userId, userId))).returning({ id: registryMirrors.id })
    return m ? { id: m.id, password: password ?? undefined } : { error: "That mirror is gone." }
  }
  if ((await countMine(registryMirrors, userId)) >= MAX_ITEMS) return { error: `You can have ${MAX_ITEMS} mirrors.` }
  const [m] = await db.insert(registryMirrors).values({ userId, ...value }).returning({ id: registryMirrors.id })
  return { id: m.id, password: password ?? undefined }
}

export async function deleteMirror(userId: string, id: string): Promise<Result> {
  await db.delete(registryMirrors).where(and(eq(registryMirrors.id, id), eq(registryMirrors.userId, userId)))
  return {}
}

export async function setMirrorEnabled(userId: string, id: string, enabled: boolean): Promise<Result> {
  await db.update(registryMirrors).set({ enabled, ...(enabled && { nextDueAt: new Date() }) }).where(and(eq(registryMirrors.id, id), eq(registryMirrors.userId, userId)))
  return {}
}

// Opens the run and hands it to the worker (the app does the work: it has the database and storage).
// The interval is pushed out now, so a slow run isn't started twice.
export async function startMirror(m: Mirror, trigger: "schedule" | "manual"): Promise<Result & { runId?: string }> {
  const [run] = await db.insert(registryToolRuns).values({ userId: m.userId, kind: "mirror", refId: m.id, label: m.name, trigger }).onConflictDoNothing().returning({ id: registryToolRuns.id })
  if (!run) return { error: "This mirror is already running." }
  await db.update(registryMirrors).set({ nextDueAt: sql`now() + make_interval(mins => ${m.intervalMin})` }).where(eq(registryMirrors.id, m.id))
  try {
    await enqueueRegistryMirror({ runId: run.id, mirrorId: m.id })
  } catch {
    await db.update(registryToolRuns).set({ status: "failed", error: "Couldn't reach the worker queue.", finishedAt: new Date() }).where(eq(registryToolRuns.id, run.id))
    return { error: "Couldn't reach the worker queue. Is Redis up?" }
  }
  return { runId: run.id }
}

export async function runMirrorNow(userId: string, id: string) {
  const [m] = await db.select().from(registryMirrors).where(and(eq(registryMirrors.id, id), eq(registryMirrors.userId, userId)))
  return m ? startMirror(m, "manual") : { error: "That mirror is gone." }
}

// The worker's job (POST /api/jobs registry-mirror-run).
export async function runMirrorJob({ runId, mirrorId }: { runId: string; mirrorId: string }) {
  const [m] = await db.select().from(registryMirrors).where(eq(registryMirrors.id, mirrorId))
  if (!m) return void (await db.update(registryToolRuns).set({ status: "failed", error: "The mirror was deleted.", finishedAt: new Date() }).where(eq(registryToolRuns.id, runId)))
  let error: string | undefined
  let res: Awaited<ReturnType<typeof syncMirror>> | undefined
  try {
    res = await syncMirror(m)
    if (res.errors.length) error = res.errors.map((e) => `${e.tag}: ${e.error}`).join("; ").slice(0, 500)
  } catch (e) {
    error = (e as Error).message || "The run failed."
  }
  await db
    .update(registryToolRuns)
    .set({ status: error ? "failed" : "ok", changed: res?.copied ?? 0, bytes: res?.bytes ?? 0, lines: res?.lines ?? [], error: error ?? null, finishedAt: new Date() })
    .where(eq(registryToolRuns.id, runId))
  if (res) await db.update(registryMirrors).set({ lastDigests: res.digests }).where(eq(registryMirrors.id, m.id))
  await settle("registry_mirrors", m, error)
  if (res?.changed.length) {
    const [repo] = await db.select({ ns: sql<string>`(select name from registry_namespaces n where n.id = ${registryRepos.namespaceId})`, name: registryRepos.name }).from(registryRepos).where(eq(registryRepos.id, m.targetRepoId))
    await notify(m.userId, "registry_mirror", {
      data: { event: "changed", name: m.name, tags: res.changed.map((c) => c.tag).join(", "), target: repo ? `${repo.ns}/${repo.name}` : "its repo", href: "/more/registry-tools?tab=history" },
    })
  }
}

// ---- Tick ----------------------------------------------------------------

// Every minute (worker job "registry-tools-tick"): due rules run here, due mirrors go to the worker.
export async function tick() {
  // A run whose app died without finishing.
  await db.update(registryToolRuns).set({ status: "failed", error: "The run didn't finish.", finishedAt: new Date() }).where(and(eq(registryToolRuns.status, "running"), lt(registryToolRuns.startedAt, sql`now() - interval '12 hours'`)))
  const [s] = await db.select({ on: settings.registryToolsEnabled, reg: settings.registry }).from(settings)
  if (!s?.on || !s.reg) return 0
  let n = 0
  for (const r of await db.select().from(registryRules).where(and(eq(registryRules.enabled, true), sql`${registryRules.nextDueAt} <= now()`))) {
    await runRule(r, "schedule").catch((e) => console.error("[registry-tools] rule", r.id, e))
    n++
  }
  for (const m of await db.select().from(registryMirrors).where(and(eq(registryMirrors.enabled, true), sql`${registryMirrors.nextDueAt} <= now()`))) {
    if ((await startMirror(m, "schedule")).runId) n++
  }
  return n
}

// ---- Views ----------------------------------------------------------------

export type RuleView = {
  id: string
  name: string
  repoId: string | null
  pattern: string | null
  scope: string
  keepLast: number | null
  olderThanDays: number | null
  keepRegex: string | null
  deleteUntagged: boolean
  intervalMin: number
  enabled: boolean
  lastRunAt: string | null
  lastStatus: "ok" | "failed" | null
  nextDueAt: string | null
  running: boolean
}

export type MirrorView = {
  id: string
  name: string
  upstream: string
  tags: string
  cap: number
  targetRepoId: string
  target: string
  username: string | null
  hasPassword: boolean
  intervalMin: number
  enabled: boolean
  lastRunAt: string | null
  lastStatus: "ok" | "failed" | null
  nextDueAt: string | null
  tracked: number
  running: boolean
}

export type RunView = {
  id: string
  kind: "rule" | "mirror"
  label: string
  trigger: "schedule" | "manual"
  status: "running" | "ok" | "failed"
  changed: number
  bytes: number
  lines: string[]
  error: string | null
  startedAt: string
  finishedAt: string | null
}

const nameOf = (repoId: typeof registryRules.repoId | typeof registryMirrors.targetRepoId) =>
  sql<string | null>`(select n.name || '/' || r.name from registry_repos r join registry_namespaces n on n.id = r.namespace_id where r.id = ${repoId})`

export async function listRules(userId: string): Promise<RuleView[]> {
  const [rows, running] = await Promise.all([
    db.select({ r: registryRules, repo: nameOf(registryRules.repoId) }).from(registryRules).where(eq(registryRules.userId, userId)).orderBy(registryRules.createdAt),
    runningIds(userId),
  ])
  return rows.map(({ r, repo }) => ({
    id: r.id, name: r.name, repoId: r.repoId, pattern: r.pattern, scope: repo ?? r.pattern ?? "", keepLast: r.keepLast, olderThanDays: r.olderThanDays,
    keepRegex: r.keepRegex, deleteUntagged: r.deleteUntagged, intervalMin: r.intervalMin, enabled: r.enabled, lastRunAt: iso(r.lastRunAt),
    lastStatus: r.lastStatus, nextDueAt: iso(r.nextDueAt), running: running.has(r.id),
  }))
}

export async function listMirrors(userId: string): Promise<MirrorView[]> {
  const [rows, running] = await Promise.all([
    db.select({ m: registryMirrors, target: nameOf(registryMirrors.targetRepoId) }).from(registryMirrors).where(eq(registryMirrors.userId, userId)).orderBy(registryMirrors.createdAt),
    runningIds(userId),
  ])
  return rows.map(({ m, target }) => ({
    id: m.id, name: m.name, upstream: m.upstream, tags: m.tags, cap: m.cap, targetRepoId: m.targetRepoId, target: target ?? "", username: m.username,
    hasPassword: Boolean(m.passwordEnc), intervalMin: m.intervalMin, enabled: m.enabled, lastRunAt: iso(m.lastRunAt), lastStatus: m.lastStatus,
    nextDueAt: iso(m.nextDueAt), tracked: Object.keys(m.lastDigests).length, running: running.has(m.id),
  }))
}

async function runningIds(userId: string) {
  const rows = await db.select({ id: registryToolRuns.refId }).from(registryToolRuns).where(and(eq(registryToolRuns.userId, userId), eq(registryToolRuns.status, "running")))
  return new Set(rows.map((r) => r.id))
}

export async function listRuns(userId: string, limit = 50): Promise<RunView[]> {
  const rows = await db.select().from(registryToolRuns).where(eq(registryToolRuns.userId, userId)).orderBy(desc(registryToolRuns.startedAt)).limit(limit)
  return rows.map((r) => ({ id: r.id, kind: r.kind, label: r.label, trigger: r.trigger, status: r.status, changed: r.changed, bytes: r.bytes, lines: r.lines, error: r.error, startedAt: r.startedAt.toISOString(), finishedAt: iso(r.finishedAt) }))
}

// For the repo pickers.
export const repoOptions = async (userId: string) => (await manageable(userId)).map((r) => ({ id: r.id, name: r.fullName }))

