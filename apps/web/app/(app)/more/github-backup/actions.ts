"use server"

import { revalidatePath } from "next/cache"

import * as conn from "@/lib/gitbackup/connections"
import * as jobs from "@/lib/gitbackup/jobs"
import * as runner from "@/lib/gitbackup/runner"
import type { Provider } from "@/lib/gitbackup/refs"
import * as setup from "@/lib/gitbackup/setup"
import { saveTokenToSecret as saveSecret } from "@/lib/registry/secrets-pull"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

// The signed-in member, only while an admin has Git Backup on.
async function member() {
  const me = await requireMember()
  if (!(await getSettings()).gitBackupEnabled) throw new Error("Git Backup is turned off on this server.")
  return me
}

const done = <T extends { error?: string }>(r: T) => {
  if (!r.error) revalidatePath("/more/github-backup", "layout")
  return r
}

// Runner calls can fail (the worker, the storage); the page shows the message instead of crashing.
async function safe<T>(f: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await f()
  } catch (e) {
    return { error: (e as Error).message || "Something went wrong. Try again." }
  }
}

// ---- connections ----
export async function addToken(v: { provider?: Provider; name?: string; token: string; host?: string }) {
  const me = await member()
  return done(await conn.createConnection(me.id, v))
}
export async function renameConnection(id: string, name: string) {
  const me = await member()
  return done(await conn.renameConnection(me.id, id, name))
}
export async function replaceToken(id: string, token: string) {
  const me = await member()
  return done(await conn.replaceToken(me.id, id, token))
}
export async function checkConnection(id: string) {
  const me = await member()
  return safe(() => conn.checkConnection(me.id, id))
}
export async function deleteConnection(id: string) {
  const me = await member()
  return done(await conn.deleteConnection(me.id, id))
}
export async function loadRepos(ref: conn.Ref, refresh: boolean) {
  const me = await member()
  return jobs.pickerFor(me.id, ref, refresh)
}

// "Keep a copy in Secrets" after adding a token; the member's own Secrets rights apply.
export async function saveTokenToSecret(o: { token: string; name: string; projectId: string; envId: string }) {
  const me = await member()
  return saveSecret(me.id, { token: String(o.token), name: String(o.name), projectId: String(o.projectId), envId: String(o.envId), what: "Git Backup token" })
}

// ---- destination ----
export async function nimbusOptions() {
  const me = await member()
  return setup.nimbusOptions(me.id)
}
export async function testS3(v: Extract<setup.DestInput, { kind: "s3" }>) {
  await member()
  return safe(() => setup.testS3(v))
}

// ---- jobs ----
export async function createJob(v: jobs.NewJob) {
  const me = await member()
  return done(await safe(() => jobs.createJob(me.id, v)))
}
export async function updateJob(id: string, v: Parameters<typeof jobs.updateJob>[2]) {
  const me = await member()
  return done(await safe(() => jobs.updateJob(me.id, id, v)))
}
export async function setPaused(id: string, paused: boolean) {
  const me = await member()
  return done(await jobs.setPaused(me.id, id, paused))
}
export async function setWebhook(id: string, on: boolean) {
  const me = await member()
  return done(await jobs.setWebhookEnabled(me.id, id, on))
}
export async function addRepos(id: string, names: string[]) {
  const me = await member()
  return done(await safe(() => jobs.addRepos(me.id, id, names)))
}
export async function removeRepo(repoId: string) {
  const me = await member()
  return done(await jobs.removeRepo(me.id, repoId))
}
export async function setRepoInterval(repoId: string, minutes: number | null) {
  const me = await member()
  return done(await jobs.setRepoInterval(me.id, repoId, minutes))
}
export async function backupNow(id: string, o: { force?: boolean; repoId?: string }) {
  const me = await member()
  return done(await jobs.backupNow(me.id, id, o))
}
export async function deleteJob(id: string, purge: boolean) {
  const me = await member()
  return done(await safe(() => jobs.deleteJob(me.id, id, purge)))
}

// ---- progress, history, restore ----
export async function progress(id: string) {
  const me = await member()
  return safe(() => runner.progress(me.id, id))
}
export async function runsOf(id: string) {
  const me = await member()
  return jobs.listRuns(me.id, id)
}
export async function snapshotsOf(repoId: string) {
  const me = await member()
  return jobs.listSnapshots(me.id, repoId)
}
export async function downloadUrl(snapshotId: string) {
  const me = await member()
  return safe(async () => ({ url: await runner.snapshotDownloadUrl(me.id, snapshotId) }))
}
export async function restoreCommand(snapshotId: string) {
  const me = await member()
  return safe(async () => ({ command: await runner.restoreCommand(me.id, snapshotId) }))
}
export async function pushSnapshot(snapshotId: string, remoteUrl: string, token?: string) {
  const me = await member()
  return safe(async () => {
    if (!/^https?:\/\/\S+$/i.test(remoteUrl.trim())) return { error: "Enter the remote's https:// address." }
    await runner.pushSnapshot(me.id, snapshotId, remoteUrl.trim(), token?.trim() || undefined)
    return {}
  })
}
export async function tree(snapshotId: string, o: { ref?: string; path?: string }) {
  const me = await member()
  return safe(() => runner.snapshotTree(me.id, snapshotId, o))
}
export async function file(snapshotId: string, o: { ref?: string; path: string }) {
  const me = await member()
  return safe(() => runner.snapshotFile(me.id, snapshotId, o))
}
