"use server"

import { revalidatePath } from "next/cache"

import * as svc from "@/lib/registry/manage"
import * as builds from "@/lib/registry/builds"
import type { GitAuth, GithubAuth } from "@/lib/registry/builds"
import { expandTags, matchRule, type RuleInput } from "@/lib/registry/build-rules"
import { toItem, type BuildItem } from "@/lib/registry/build-view"
import { projectCtx, listSecrets } from "@/lib/secrets/service"
import { requireMember } from "@/lib/session"

const NOT_ON: { error: string; id?: string; webhookUrl?: string; webhookSecret?: string } = { error: "The registry isn't available for your account right now." }

async function member() {
  const me = await requireMember()
  return (await svc.registryState(me.id)) === "ready" ? me : null
}
const done = <T extends { error?: string }>(r: T) => {
  if (!r.error) revalidatePath("/registry", "layout")
  return r
}

export async function githubRepos(token: string) {
  if (!(await member())) return NOT_ON
  const r = await builds.listGithubRepos(String(token).slice(0, 500))
  return Array.isArray(r) ? { repos: r } : r
}
export async function githubReposVia(repoId: string, connectionId: string) {
  const me = await member()
  if (!me) return NOT_ON
  const r = await builds.listGithubReposFor(me.id, repoId, String(connectionId))
  return Array.isArray(r) ? { repos: r } : r
}
export async function connectGithub(repoId: string, v: { repo: string } & GithubAuth) {
  const me = await member()
  return me ? done(await builds.connectGithub(me.id, repoId, v)) : NOT_ON
}
export async function connectGit(repoId: string, v: { url: string } & GitAuth) {
  const me = await member()
  return me ? done(await builds.connectGit(me.id, repoId, v)) : NOT_ON
}
export async function changeConnection(repoId: string, connectionId: string) {
  const me = await member()
  return me ? done(await builds.changeConnection(me.id, repoId, String(connectionId))) : NOT_ON
}
export async function useUploadsOnly(repoId: string) {
  const me = await member()
  return me ? done(await builds.useUploadsOnly(me.id, repoId)) : NOT_ON
}
export async function disconnectSource(repoId: string) {
  const me = await member()
  return me ? done(await builds.disconnectSource(me.id, repoId)) : NOT_ON
}

export async function saveRule(repoId: string, ruleId: string | null, input: RuleInput) {
  const me = await member()
  return me ? done(await builds.saveRule(me.id, repoId, ruleId, input)) : NOT_ON
}
export async function deleteRule(ruleId: string) {
  const me = await member()
  return me ? done(await builds.deleteRule(me.id, ruleId)) : NOT_ON
}

export async function startBuild(repoId: string, o: { ruleId?: string; ref?: { type: "branch" | "tag"; name: string } }) {
  const me = await member()
  return me ? done(await builds.startBuild(me.id, repoId, o)) : NOT_ON
}
export async function cancelBuild(id: string) {
  const me = await member()
  return me ? done(await builds.cancelBuild(me.id, id)) : NOT_ON
}
export async function newBadgeToken(repoId: string) {
  const me = await member()
  return me ? done(await builds.newBadgeToken(me.id, repoId)) : NOT_ON
}
export async function buildOutlook() {
  return (await member()) ? builds.buildOutlook() : null
}
export async function retryBuild(id: string) {
  const me = await member()
  return me ? done(await builds.retryBuild(me.id, id)) : NOT_ON
}

// One page of history (newest first); `before` is the last row's created time. Also what the 5 second refresh calls.
export async function buildPage(name: string, o: { before?: string; limit?: number } = {}): Promise<{ rows: BuildItem[]; more: boolean }> {
  const me = await member()
  const id = me && (await svc.writableRepoId(me.id, name))
  if (!id) return { rows: [], more: false }
  const before = o.before ? new Date(o.before) : undefined
  const limit = Math.min(o.limit ?? 30, 100)
  const rows = await builds.listBuilds(id, { limit: limit + 1, before: before && !Number.isNaN(before.getTime()) ? before : undefined })
  return { rows: rows.slice(0, limit).map(toItem), more: rows.length > limit }
}

// The whole log of a finished (or running) build, for "Load full log".
export async function fullBuildLog(buildId: string) {
  const me = await member()
  if (!me || !(await svc.writableBuildRepo(me.id, buildId))) return null
  return builds.buildLog(buildId)
}

export async function buildSecretKeys(projectId: string, envId: string): Promise<{ keys?: { id: string; key: string }[]; locked?: boolean; error?: string }> {
  const me = await member()
  if (!me) return NOT_ON
  const c = await projectCtx(me.id, projectId).catch(() => null)
  if (!c) return { locked: true }
  try {
    return { keys: (await listSecrets(c, envId, null)).map((s) => ({ id: s.id, key: s.key })) }
  } catch {
    return { error: "Couldn't list the secrets in that environment." }
  }
}

// Live helper in the rule editor: does this name match the pattern, and which image tags would it get.
export async function previewRule(r: { sourceType: "branch" | "tag"; pattern: string; tags: string[]; sample: string }) {
  await requireMember()
  const sample = String(r.sample).slice(0, 200)
  const ctx = { sha: "a1b2c3d4e5f6", ...(r.sourceType === "tag" ? { tag: sample } : { branch: sample }) }
  return {
    matches: matchRule({ sourceType: r.sourceType, pattern: String(r.pattern).slice(0, 200) }, { type: r.sourceType, name: sample }),
    tags: expandTags(r.tags.slice(0, 10).map((t) => String(t).slice(0, 128)), ctx),
  }
}
