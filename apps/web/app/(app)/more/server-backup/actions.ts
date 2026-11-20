"use server"

import { revalidatePath } from "next/cache"

import { saveTokenToSecret as saveSecret } from "@/lib/registry/secrets-pull"
import * as hosts from "@/lib/server-backup/hosts"
import * as jobs from "@/lib/server-backup/jobs"
import * as restore from "@/lib/server-backup/restore"
import { allowed } from "@/lib/server-backup/access"
import * as setup from "@/lib/gitbackup/setup"
import { dockerSocket } from "@/lib/server-backup/exec"
import { isAdmin, requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

// The signed-in member, only while Server Backup is on for them.
async function member() {
  const me = await requireMember()
  if (!allowed(await getSettings(), me.role)) throw new Error("Server Backup isn't available to you on this server.")
  return { me, admin: isAdmin(me.role) }
}

const done = <T extends { error?: string }>(r: T) => {
  if (!r.error) revalidatePath("/more/server-backup", "layout")
  return r
}

// ssh, restic and the storage can fail in many ways; the page shows the message instead of crashing.
async function safe<T>(f: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await f()
  } catch (e) {
    return { error: (e as Error).message || "Something went wrong. Try again." }
  }
}

// ---- servers ----
export async function addHost(v: hosts.NewHost) {
  const { me, admin } = await member()
  return done(await safe(() => hosts.addHost(me.id, admin, v)))
}
export async function addSelf() {
  const { me, admin } = await member()
  return done(await safe(() => hosts.addSelf(me.id, admin)))
}
export async function testHost(id: string, trustNew = false) {
  const { me } = await member()
  return done(await safe(() => hosts.testHost(me.id, id, trustNew)))
}
export async function deleteHost(id: string) {
  const { me } = await member()
  return done(await hosts.deleteHost(me.id, id))
}
export async function newAgentToken(id: string) {
  const { me } = await member()
  return safe(() => hosts.newAgentToken(me.id, id))
}
export async function volumesOf(id: string) {
  const { me } = await member()
  return safe(() => hosts.listVolumes(me.id, id))
}
export async function dockerReady() {
  await member()
  return dockerSocket()
}

// ---- destination ----
export async function nimbusOptions() {
  const { me } = await member()
  return setup.nimbusOptions(me.id)
}
export async function testS3(v: Extract<setup.DestInput, { kind: "s3" }>) {
  await member()
  return safe(() => setup.testS3(v))
}

// ---- jobs ----
export async function createJob(v: jobs.NewJob) {
  const { me, admin } = await member()
  return done(await safe(() => jobs.createJob(me.id, admin, v)))
}
export async function updateJob(id: string, v: jobs.JobEdit) {
  const { me, admin } = await member()
  return done(await safe(() => jobs.updateJob(me.id, admin, id, v)))
}
export async function setPaused(id: string, paused: boolean) {
  const { me } = await member()
  return done(await jobs.setPaused(me.id, id, paused))
}
export async function backupNow(id: string) {
  const { me } = await member()
  return done(await jobs.backupNow(me.id, id))
}
export async function deleteJob(id: string, purge: boolean) {
  const { me } = await member()
  return done(await safe(() => jobs.deleteJob(me.id, id, purge)))
}
export async function progress(id: string) {
  const { me } = await member()
  return safe(() => jobs.activeRun(me.id, id))
}

// ---- snapshots and restore ----
export async function browse(snapshotId: string, dir: string) {
  const { me } = await member()
  return safe(async () => {
    const c = await restore.snapshotCtx(me.id, snapshotId)
    if (!c) return { error: "That snapshot isn't here." }
    return { entries: await restore.children(c, dir) }
  })
}
export async function restoreSsh(snapshotId: string, o: { target: "original" | string; confirmName?: string }) {
  const { me } = await member()
  return safe(() => restore.restoreOverSsh(me.id, snapshotId, o))
}
export async function restoreFiles(snapshotId: string, o: { folderId: string | null; path?: string }) {
  const { me } = await member()
  return safe(() => restore.restoreToFiles(me.id, snapshotId, o))
}
export async function commandOf(snapshotId: string) {
  const { me } = await member()
  const c = await restore.snapshotCtx(me.id, snapshotId)
  return c ? { command: restore.restoreCommand(c) } : { error: "That snapshot isn't here." }
}

// "Save to Secrets" for the repository password shown once; the member's own Secrets rights apply.
export async function saveTokenToSecret(o: { token: string; name: string; projectId: string; envId: string }) {
  const { me } = await member()
  return saveSecret(me.id, { token: String(o.token), name: String(o.name), projectId: String(o.projectId), envId: String(o.envId), what: "Server Backup password" })
}
