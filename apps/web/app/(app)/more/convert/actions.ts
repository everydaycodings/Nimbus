"use server"

import { revalidatePath } from "next/cache"

import * as c from "@/lib/convert/jobs"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

// The signed-in member, only while an admin has the converter on.
async function member() {
  const me = await requireMember()
  if (!(await getSettings()).convertToolEnabled) throw new Error("The media converter is turned off on this server.")
  return me
}

const fresh = () => revalidatePath("/more/convert")

// The queue and today's quota, polled by the page.
export async function queue() {
  const me = await member()
  const [jobs, quota] = await Promise.all([c.listJobs(me.id), c.quotaOf(me.id)])
  return { jobs, quota }
}

// For the Convert… dialog; `off` when an admin turned the tool off (the file menu shows it regardless).
export async function convertOptions() {
  const me = await requireMember()
  if (!(await getSettings()).convertToolEnabled) return { off: true as const }
  return { off: false as const, presets: await c.listPresets(me.id), quota: await c.quotaOf(me.id) }
}

export async function start(ids: string[], preset: string, trim?: { start?: number; end?: number }) {
  const me = await member()
  const r = await c.createJobs(me.id, ids.map(String), String(preset), trim)
  fresh()
  return r
}
export async function cancel(id: string) {
  const me = await member()
  await c.cancelJob(me.id, id)
}
export async function clearDone() {
  const me = await member()
  await c.clearFinished(me.id)
  fresh()
}

export async function savePreset(v: { id?: string; name: string; preset: unknown }) {
  const me = await member()
  const r = await c.savePreset(me.id, v)
  if (!r.error) fresh()
  return r
}
export async function deletePreset(id: string) {
  const me = await member()
  await c.deletePreset(me.id, id)
  fresh()
}

export async function addWatch(folderId: string, preset: string) {
  const me = await member()
  const r = await c.addWatch(me.id, String(folderId), String(preset))
  if (!r.error) fresh()
  return r
}
export async function removeWatch(id: string) {
  const me = await member()
  await c.removeWatch(me.id, id)
  fresh()
}

export async function findMedia(q: string) {
  const me = await member()
  return c.findMedia(me.id, String(q).slice(0, 100))
}
