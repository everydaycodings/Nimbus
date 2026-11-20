"use server"

import { revalidatePath } from "next/cache"

import * as conn from "@/lib/import/connections"
import * as jobs from "@/lib/import/jobs"
import { guardRemote, keepToken, ownConnection, remoteOf } from "@/lib/import/connections"
import { withRemote } from "@/lib/import/rclone"
import { spaceLeft } from "@/lib/quota"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

// The signed-in member, only while an admin has Cloud import on.
async function member() {
  const me = await requireMember()
  if (!(await getSettings()).importToolEnabled) throw new Error("Cloud import is turned off on this server.")
  return me
}

const done = <T extends object>(r: T) => {
  if (!("error" in r && r.error)) revalidatePath("/more/import", "layout")
  return r
}

// rclone and the services can fail in many ways; the page shows the message instead of crashing.
async function safe<T>(f: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await f()
  } catch (e) {
    return { error: (e as Error).message || "Something went wrong. Try again." }
  }
}

// ---- connections ----
export async function addConnection(v: conn.NewConnection) {
  const me = await member()
  return done(await safe(() => conn.createConnection(me.id, v)))
}
export async function renameConnection(id: string, label: string) {
  const me = await member()
  return done(await conn.renameConnection(me.id, id, label))
}
export async function checkConnection(id: string) {
  const me = await member()
  return done(await safe(() => conn.checkConnection(me.id, id)))
}
export async function deleteConnection(id: string) {
  const me = await member()
  return done(await conn.deleteConnection(me.id, id))
}

// ---- the folder picker ----
async function withConn<T>(id: string, f: (rc: Parameters<Parameters<typeof withRemote>[1]>[0]) => Promise<T>) {
  const me = await member()
  const c = await ownConnection(me.id, id)
  if (!c) throw new Error("That connection is gone.")
  const r = remoteOf(c)
  await guardRemote(r)
  return withRemote(r, f, keepToken(c.id))
}

export async function remoteDirs(connectionId: string, path: string) {
  return safe(async () => (await withConn(connectionId, (rc) => rc.dirs(String(path)))).map((d) => ({ name: d.Name, path: [String(path), d.Name].filter(Boolean).join("/") })))
}
export async function remoteSize(connectionId: string, path: string) {
  return safe(() => withConn(connectionId, (rc) => rc.size(String(path))))
}
// Bytes the member has left, null for no limit.
export async function freeSpace() {
  const me = await member()
  return spaceLeft(me.id)
}
export async function pathOf(folderId: string) {
  await member()
  return [...(await jobs.folderPaths([folderId]))][0]?.[1] ?? "/"
}
export async function zips(q: string) {
  const me = await member()
  return jobs.findZips(me.id, String(q ?? ""))
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
export async function runNow(id: string) {
  const me = await member()
  return done(await safe(() => jobs.runNow(me.id, id)))
}
export async function controlRun(id: string, what: "pause" | "resume" | "cancel") {
  const me = await member()
  return done(await safe(() => jobs.controlRun(me.id, id, what)))
}
export async function deleteJob(id: string) {
  const me = await member()
  return done(await safe(() => jobs.deleteJob(me.id, id)))
}
export async function progress(id: string) {
  const me = await member()
  return safe(() => jobs.jobProgress(me.id, id))
}
