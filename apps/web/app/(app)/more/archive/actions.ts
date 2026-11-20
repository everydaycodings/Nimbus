"use server"

import { revalidatePath } from "next/cache"

import * as a from "@/lib/archive/run"
import { MAX_IMPORT, parseBookmarks, parseUrlList, splitTags } from "@/lib/archive/rules"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

// The signed-in member, only while an admin has the archive on.
async function member() {
  const me = await requireMember()
  if (!(await getSettings()).archiverToolEnabled) throw new Error("The website archive is turned off on this server.")
  return me
}

const fresh = () => revalidatePath("/more/archive", "layout")
type Result = { error?: string }

// The library, polled while something is being captured.
export async function library() {
  const me = await member()
  return a.listPages(me.id)
}

export async function addUrls(text: string, tags: string, folderId: string | null): Promise<Result & { added?: number; existing?: number; bad?: string[] }> {
  const me = await member()
  const { urls, bad } = parseUrlList(String(text).slice(0, 200_000))
  if (!urls.length) return { error: bad.length ? "Those aren't web addresses. Start each with http:// or https://." : "Paste at least one address." }
  if (urls.length > MAX_IMPORT) return { error: `Add up to ${MAX_IMPORT} pages at a time.` }
  const r = await a.addPages(me.id, urls.map((url) => ({ url })), { tags: splitTags(String(tags)), folderId })
  if (r.error) return { error: r.error }
  fresh()
  return { added: r.added, existing: r.existing, bad }
}

export async function importBookmarks(form: FormData): Promise<Result & { added?: number; existing?: number }> {
  const me = await member()
  const file = form.get("file")
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a bookmarks.html file." }
  if (file.size > 20 * 1024 * 1024) return { error: "That file is too big for a bookmarks export." }
  const items = parseBookmarks(await file.text())
  if (!items.length) return { error: "No web bookmarks found in that file. Export bookmarks as HTML from your browser." }
  const r = await a.addPages(me.id, items, { tags: splitTags(String(form.get("tags") ?? "")), folderId: String(form.get("folder") ?? "") || null })
  if (r.error) return { error: r.error }
  fresh()
  return { added: r.added, existing: r.existing }
}

export async function captureNow(id: string): Promise<Result> {
  const me = await member()
  const r = await a.startCapture(me.id, id)
  fresh()
  return r
}

export async function schedule(id: string, minutes: number | null): Promise<Result> {
  const me = await member()
  const r = await a.setSchedule(me.id, id, minutes)
  fresh()
  return r
}

export async function retag(id: string, tags: string): Promise<Result> {
  const me = await member()
  await a.setTags(me.id, id, splitTags(String(tags)))
  fresh()
  return {}
}

export async function pickCookie(id: string, domain: string | null): Promise<Result> {
  const me = await member()
  const r = await a.setPageCookie(me.id, id, domain)
  fresh()
  return r
}

export async function remove(id: string): Promise<Result> {
  const me = await member()
  await a.deletePage(me.id, id)
  fresh()
  return {}
}

export async function saveCookie(domain: string, header: string): Promise<Result> {
  const me = await member()
  const r = await a.saveCookie(me.id, String(domain), String(header))
  if (!r.error) fresh()
  return r
}

export async function removeCookie(id: string): Promise<Result> {
  const me = await member()
  await a.deleteCookie(me.id, id)
  fresh()
  return {}
}

export async function chooseFolder(folderId: string | null): Promise<Result> {
  const me = await member()
  const r = await a.setDefaultFolder(me.id, folderId)
  if (!r.error) fresh()
  return r
}

// The bookmarklet page: saves one address and captures it.
export async function saveOne(url: string, tags: string): Promise<Result & { id?: string; existing?: boolean }> {
  const me = await member()
  const { urls } = parseUrlList(String(url))
  if (urls.length !== 1) return { error: "That isn't a web address." }
  const r = await a.addPages(me.id, [{ url: urls[0] }], { tags: splitTags(String(tags)) })
  if (r.error) return { error: r.error }
  fresh()
  return { id: r.ids[0], existing: r.existing > 0 }
}
