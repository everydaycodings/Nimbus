"use server"

import { revalidatePath } from "next/cache"

import { audit } from "@/lib/audit"
import { listEvents } from "@/lib/registry/activity"
import { createHook, deleteHook, testHook } from "@/lib/registry/hooks"
import * as svc from "@/lib/registry/manage"
import * as admin from "@/lib/registry/repo-admin"
import { requestScan } from "@/lib/registry/scan"
import { saveTokenToSecret } from "@/lib/registry/secrets-pull"
import { setReadme } from "@/lib/registry/readme"
import { applyPolicy, previewPolicy } from "@/lib/registry/policy"
import { requireMember } from "@/lib/session"

const NOT_ON: { error: string; id?: string; conflict?: boolean } = { error: "The registry isn't available for your account right now." }

// Everything past claiming a name needs a working registry and a claimed name.
async function member() {
  const me = await requireMember()
  return (await svc.registryState(me.id)) === "ready" ? me : null
}

const done = <T extends { error?: string }>(r: T) => {
  if (!r.error) revalidatePath("/registry", "layout")
  return r
}

export async function checkName(name: string) {
  await requireMember()
  return svc.checkName(String(name).slice(0, 64))
}

export async function claimName(name: string) {
  const me = await requireMember()
  const s = await svc.registryState(me.id)
  if (s !== "unclaimed") return { error: "You can't claim a name right now." }
  return done(await svc.claimName(me.id, name))
}

export async function createOrg(name: string, displayName: string) {
  const me = await member()
  return me ? done(await svc.createOrg(me.id, name, displayName)) : NOT_ON
}
export async function renameOrg(id: string, displayName: string) {
  const me = await member()
  return me ? done(await svc.renameOrg(me.id, id, displayName)) : NOT_ON
}
export async function deleteOrg(id: string) {
  const me = await member()
  return me ? done(await svc.deleteOrg(me.id, id)) : NOT_ON
}
export async function orgMembers(id: string) {
  const me = await member()
  return me ? svc.orgMembers(me.id, id) : []
}
export async function addOrgMember(id: string, email: string, role: string) {
  const me = await member()
  return me ? done(await svc.addOrgMember(me.id, id, email, role)) : NOT_ON
}
export async function setOrgRole(id: string, userId: string, role: string) {
  const me = await member()
  return me ? done(await svc.setOrgRole(me.id, id, userId, role)) : NOT_ON
}
export async function removeOrgMember(id: string, userId: string) {
  const me = await member()
  return me ? done(await svc.removeOrgMember(me.id, id, userId)) : NOT_ON
}

export async function setRepoPublic(name: string, isPublic: boolean) {
  const me = await member()
  return me ? done(await svc.setRepoPublic(me.id, name, isPublic)) : NOT_ON
}
export async function setImmutable(name: string, pattern: string) {
  const me = await member()
  return me ? done(await svc.setImmutable(me.id, name, pattern)) : NOT_ON
}
export async function setBlockCritical(name: string, on: boolean) {
  const me = await member()
  return me ? done(await svc.setBlockCritical(me.id, name, on)) : NOT_ON
}
export async function deleteRepo(name: string) {
  const me = await member()
  return me ? done(await svc.deleteRepo(me.id, name)) : NOT_ON
}
export async function deleteTag(name: string, tag: string) {
  const me = await member()
  return me ? done(await svc.deleteTag(me.id, name, tag)) : NOT_ON
}

// Many tags at once: each goes through deleteTag (immutable and archived rules, audit, activity). Returns what moved, and why the rest didn't.
export async function deleteTags(name: string, tags: string[]) {
  const me = await member()
  if (!me) return { ids: [], skipped: tags.map((tag) => ({ tag, error: NOT_ON.error })) }
  const ids: string[] = []
  const skipped: { tag: string; error: string }[] = []
  for (const tag of tags.slice(0, 200)) {
    const r = await svc.deleteTag(me.id, name, tag)
    if (r.error || !r.id) skipped.push({ tag, error: r.error ?? "Already gone." })
    else ids.push(r.id)
  }
  done({})
  return { ids, skipped }
}

export async function createToken(o: svc.NewToken): ReturnType<typeof svc.createToken> {
  const me = await member()
  return me ? done(await svc.createToken(me.id, o)) : NOT_ON
}
export async function revokeToken(id: string) {
  const me = await requireMember()
  return done(await svc.revokeToken(me.id, id))
}

export async function restoreTrash(kind: string, id: string, as?: string) {
  const me = await member()
  return me ? done(await svc.restoreFromTrash(me.id, kind, id, as)) : NOT_ON
}
export async function purgeTrashItem(kind: string, id: string) {
  const me = await member()
  return me ? done(await svc.purgeFromTrash(me.id, kind, id)) : NOT_ON
}

type Result = { error?: string }
export type Policies = Record<string, unknown>
export type Preview = { error?: string; tags?: { repo: string; name: string }[]; untagged?: { repo: string; name: string }[]; repos?: number }

// What the unsaved policy would trash: one repo, or every repo in the namespace that follows its default.
export async function previewCleanup(scope: { repo: string } | { namespace: string }, raw: Policies): Promise<Preview> {
  const me = await member()
  if (!me) return NOT_ON
  const { policy, error } = svc.parsePolicy(raw)
  if (error) return { error }
  if (!policy) return { error: "Set at least one rule to preview." }
  const targets =
    "repo" in scope
      ? await svc.writableRepoId(me.id, scope.repo).then((id) => (id ? [{ id, fullName: scope.repo }] : []))
      : (await svc.inheritingRepos(me.id, scope.namespace)).slice(0, 100)
  const out: Preview = { tags: [], untagged: [], repos: targets.length }
  for (const t of targets) {
    const r = await previewPolicy(t.id, policy)
    out.tags!.push(...r.tags.map((name) => ({ repo: t.fullName, name })))
    out.untagged!.push(...r.untagged.map((name) => ({ repo: t.fullName, name })))
  }
  return out
}

export async function saveNamespacePolicy(ns: string, raw: Policies) {
  const me = await member()
  return me ? done(await svc.setNamespacePolicy(me.id, ns, raw)) : NOT_ON
}
// Null raw: follow the namespace default again.
export async function saveRepoPolicy(name: string, raw: Policies | null) {
  const me = await member()
  return me ? done(await svc.setRepoPolicy(me.id, name, raw)) : NOT_ON
}
export async function runCleanup(name: string): Promise<Result> {
  const me = await member()
  if (!me) return NOT_ON
  const id = await svc.writableRepoId(me.id, name)
  if (!id) return { error: "You can only read this repository." }
  try {
    await applyPolicy(id)
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The cleanup didn't run." }
  }
  await svc.log(me.id, { repoId: id }, "cleanup_run")
  return done({})
}

// Runs the saved namespace rules on every repository that follows them.
export async function runNamespaceCleanup(ns: string): Promise<Result> {
  const me = await member()
  if (!me) return NOT_ON
  const repos = await svc.inheritingRepos(me.id, ns)
  try {
    for (const r of repos) await applyPolicy(r.id)
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The cleanup didn't run." }
  }
  return done({})
}

export async function namespaceSettings(ns: string) {
  const me = await member()
  if (!me) return null
  const mine = (await svc.ownedNamespaces(me.id)).find((n) => n.name === ns)
  return mine ? { policy: mine.policy, hooks: await svc.listHooksFor(me.id, ns) } : null
}
export async function repoHooks(name: string) {
  const me = await member()
  const [ns, ...rest] = name.split("/")
  return me ? svc.listHooksFor(me.id, ns, rest.join("/")) : []
}

// `repo` is the part after the namespace; blank for a namespace-wide hook. The secret comes back once.
export async function addHook(ns: string, repo: string, url: string, events: string[]): Promise<Result & { secret?: string }> {
  const me = await member()
  if (!me) return NOT_ON
  const target = await svc.hookTarget(me.id, ns, repo || undefined)
  if (!target) return { error: "You can't add webhooks here." }
  const ev = events.filter((e): e is "push" | "delete" | "scan" | "build" => e === "push" || e === "delete" || e === "scan" || e === "build")
  if (!ev.length) return { error: "Pick at least one event." }
  try {
    const r = await createHook(me.id, { ...target, url: url.trim(), events: ev })
    await audit("registry_hook", { detail: `added ${repo ? `${ns}/${repo}` : ns}: ${url.trim()}` })
    await svc.log(me.id, target, "hook_add", { url: url.trim() })
    return { secret: r.secret }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't add the webhook." }
  }
}
export async function removeHook(id: string): Promise<Result> {
  const me = await member()
  if (!me) return NOT_ON
  if (!(await svc.canManageHook(me.id, id))) return { error: "You can't change that webhook." }
  const at = await svc.hookNamespace(id)
  await deleteHook(me.id, id)
  await audit("registry_hook", { detail: "removed a webhook" })
  if (at) await svc.log(me.id, at, "hook_remove")
  return {}
}
export async function toggleHook(id: string, enabled: boolean) {
  const me = await member()
  return me ? svc.setHookEnabled(me.id, id, enabled) : NOT_ON
}
export async function sendTestHook(id: string): Promise<Result> {
  const me = await member()
  if (!me) return NOT_ON
  if (!(await svc.canManageHook(me.id, id))) return { error: "You can't change that webhook." }
  try {
    await testHook(me.id, id)
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The test didn't send." }
  }
  return {}
}
export async function hookLog(id: string) {
  const me = await member()
  return me ? svc.hookDeliveries(me.id, id) : []
}

export async function searchRepos(q: string) {
  return svc.searchRepos((await requireMember()).id, q)
}

export async function searchRegistryTags(q: string) {
  return svc.searchTags((await requireMember()).id, q)
}

export async function rescanTag(name: string, tag: string): Promise<Result> {
  const me = await member()
  if (!me) return NOT_ON
  const id = await svc.writableTagManifest(me.id, name, tag)
  if (!id) return { error: "You can only read this repository." }
  await requestScan(id)
  return done({})
}

// Blank (null) goes back to the image label.
export async function saveReadme(name: string, markdown: string | null): Promise<Result> {
  const me = await member()
  if (!me) return NOT_ON
  const id = await svc.writableRepoId(me.id, name)
  if (!id) return { error: "You can only read this repository." }
  try {
    await setReadme(me.id, id, markdown)
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the README." }
  }
  return done({})
}

// Repositories the member can pick when setting up a Secrets "registry pull" connection.
export async function registryRepoChoices() {
  const me = await member()
  return me ? (await svc.listRepos(me.id)).map((r) => ({ id: r.id, fullName: r.fullName })) : []
}

export async function saveRegistryTokenToSecret(o: { token: string; name: string; projectId: string; envId: string }) {
  const me = await member()
  return me ? saveTokenToSecret(me.id, o) : { ...NOT_ON, locked: false, requested: false }
}

// ---- Repo administration (role checks live in repo-admin) ----

export async function checkRepoName(ns: string, name: string) {
  await requireMember()
  return svc.checkRepoName(String(ns).slice(0, 64), String(name).slice(0, 255))
}
export async function renameRepo(repoId: string, to: { namespace: string; name: string }) {
  const me = await member()
  return me ? done(await admin.renameRepo(me.id, repoId, to)) : { error: NOT_ON.error }
}
export async function setArchived(repoId: string, archived: boolean) {
  const me = await member()
  return me ? done(await admin.setArchived(me.id, repoId, archived)) : NOT_ON
}
export async function setDescription(repoId: string, text: string | null) {
  const me = await member()
  return me ? done(await admin.setDescription(me.id, repoId, text)) : NOT_ON
}
export async function addCollaborator(repoId: string, email: string, role: string) {
  const me = await member()
  return me ? done(await admin.addCollaborator(me.id, repoId, email, role)) : NOT_ON
}
export async function setCollaboratorRole(repoId: string, userId: string, role: string) {
  const me = await member()
  return me ? done(await admin.setCollaboratorRole(me.id, repoId, userId, role)) : NOT_ON
}
export async function removeCollaborator(repoId: string, userId: string) {
  const me = await member()
  return me ? done(await admin.removeCollaborator(me.id, repoId, userId)) : NOT_ON
}
// Both read-only lists below are for admins of the repo (or owners of its name).
export async function repoAccess(repoId: string) {
  const me = await member()
  const r = me && (await svc.adminRepoAccess(me.id, repoId))
  return r || null
}
export async function setTeamRepo(teamId: string, repoId: string, role: string | null) {
  const me = await member()
  return me ? done(await admin.setTeamRepo(me.id, teamId, repoId, role)) : NOT_ON
}

export async function orgTeams(orgId: string) {
  const me = await member()
  return me && (await svc.isOrgOwner(me.id, orgId)) ? admin.listTeams(orgId) : []
}
export async function createTeam(orgId: string, name: string) {
  const me = await member()
  return me ? done(await admin.createTeam(me.id, orgId, name)) : NOT_ON
}
export async function renameTeam(teamId: string, name: string) {
  const me = await member()
  return me ? done(await admin.renameTeam(me.id, teamId, name)) : NOT_ON
}
export async function deleteTeam(teamId: string) {
  const me = await member()
  return me ? done(await admin.deleteTeam(me.id, teamId)) : NOT_ON
}
export async function addTeamMember(teamId: string, userId: string) {
  const me = await member()
  return me ? done(await admin.addTeamMember(me.id, teamId, userId)) : NOT_ON
}
export async function removeTeamMember(teamId: string, userId: string) {
  const me = await member()
  return me ? done(await admin.removeTeamMember(me.id, teamId, userId)) : NOT_ON
}

// One page of the activity log for a repo or a whole registry name; `before` is the last row's time.
export type ActivityScope = { repoId: string } | { namespaceId: string }
const PAGE = 30
export async function activityPage(scope: ActivityScope, o: { actorId?: string; repoId?: string; before?: string }) {
  const me = await member()
  if (!me || !(await svc.canSeeScope(me.id, scope))) return { rows: [], more: false }
  const before = o.before ? new Date(o.before) : undefined
  const rows = await listEvents({
    ...("repoId" in scope ? { repoId: scope.repoId } : { namespaceId: scope.namespaceId, repoId: o.repoId }),
    actorId: o.actorId,
    before: before && !Number.isNaN(before.getTime()) ? before : undefined,
    limit: PAGE + 1,
  })
  const named = await svc.withNames(rows.slice(0, PAGE))
  return { rows: named.map((e) => ({ ...e, at: e.at.toISOString() })), more: rows.length > PAGE }
}
