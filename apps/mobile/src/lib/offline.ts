// Offline files: what's marked, the copies on the phone, and the refresh that keeps them current.
// No UI imports, so the background task can run it headlessly (offline-task.ts).
import type { Details, Item, PreviewResponse } from "@nimbus/shared/api"
import { File } from "expo-file-system"
import * as Network from "expo-network"
import * as SecureStore from "expo-secure-store"
import Storage from "expo-sqlite/kv-store"
import { useSyncExternalStore } from "react"

import { ApiError, json, type Account } from "./api"
import { fetchTo, offlineFile, offlineFolder } from "./file-cache"
import { native } from "./native"
import { db } from "./offline-db"
import { DEFAULT_CAP, planRefresh } from "./offline-rules"

// ---- Settings ----

export const getCap = (): number | null => {
  const v = Storage.getItemSync("offline.cap")
  return v === null ? DEFAULT_CAP : v === "none" ? null : Number(v)
}
export const setCap = (cap: number | null) => {
  Storage.setItemSync("offline.cap", cap === null ? "none" : String(cap))
  emit()
}
export const getCellular = () => Storage.getItemSync("offline.cellular") === "1"
export const setCellular = (on: boolean) => {
  Storage.setItemSync("offline.cellular", on ? "1" : "0")
  emit()
}
export const lastRefresh = (account: string) => Number(Storage.getItemSync(`offline.last.${account}`)) || null

// Optional on an installed app from before Phase 6.
export const tellNative = (account: string) => {
  const fn = (native as { notifyFilesChanged?: (a: string) => void } | null)?.notifyFilesChanged
  if (typeof fn === "function") fn.call(native, account)
}

// ---- What's on the phone, for the screens ----

export type Snap = {
  // Items someone marked, as they were last seen.
  roots: Item[]
  // Every item the marks cover, folders and files; files with bytes on the phone.
  covered: Set<string>
  files: Set<string>
  // The marked item covering each covered one.
  rootOf: Map<string, string>
  bytes: number
  count: number
}

const snaps = new Map<string, Snap>()
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
function emit(account?: string) {
  if (account) snaps.delete(account)
  else snaps.clear()
  listeners.forEach((fn) => fn())
}

function load(account: string): Snap {
  const d = db()
  const marks = new Set(d.getAllSync<{ id: string }>("SELECT id FROM offline_marks WHERE account=?", account).map((r) => r.id))
  const rows = d.getAllSync<{ id: string; root: string; item: string }>("SELECT id, root, item FROM offline_items WHERE account=?", account)
  const roots: Item[] = []
  for (const r of rows) if (marks.has(r.id)) roots.push(JSON.parse(r.item))
  const files = d.getAllSync<{ id: string; size: number }>("SELECT id, size FROM offline_files WHERE account=?", account)
  return {
    roots: roots.sort((a, b) => a.name.localeCompare(b.name)),
    covered: new Set(rows.map((r) => r.id)),
    rootOf: new Map(rows.map((r) => [r.id, r.root])),
    files: new Set(files.map((f) => f.id)),
    bytes: files.reduce((n, f) => n + f.size, 0),
    count: files.length,
  }
}

export function snapshot(account: string) {
  let s = snaps.get(account)
  if (!s) snaps.set(account, (s = load(account)))
  return s
}
export const useOffline = (account: string) => useSyncExternalStore(subscribe, () => snapshot(account))

// A folder's children from the offline store, for browsing a folder with no connection.
export function offlineChildren(account: string, parent: string): Item[] {
  return db()
    .getAllSync<{ item: string }>("SELECT item FROM offline_items WHERE account=? AND parent=?", account, parent)
    .map((r) => JSON.parse(r.item) as Item)
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1))
}

// ---- Notices: told once, next time the app is open ----

const NOTICES = "offline.notices"
export function addNotice(text: string) {
  const list: string[] = JSON.parse(Storage.getItemSync(NOTICES) ?? "[]")
  Storage.setItemSync(NOTICES, JSON.stringify([...list, text].slice(-20)))
}
export function takeNotices(): string[] {
  const list: string[] = JSON.parse(Storage.getItemSync(NOTICES) ?? "[]")
  if (list.length) Storage.setItemSync(NOTICES, "[]")
  return list
}

// ---- Refresh progress, for the Offline screen ----

type Status = { running: boolean; text: string | null }
let status: Status = { running: false, text: null }
const setStatus = (next: Status) => {
  status = next
  listeners.forEach((fn) => fn())
}
export const useRefreshStatus = () => useSyncExternalStore(subscribe, () => status)

// ---- Changing what's marked ----

const insertItem = (account: string, item: Item, parent: string | null, root: string) =>
  db().runSync("INSERT OR REPLACE INTO offline_items(account,id,parent,root,item) VALUES(?,?,?,?,?)", account, item.id, parent, root, JSON.stringify(item))

// Marks the items and gives each a first look at once; the downloads follow in the background.
// `parent`: the folder it was marked from, "root" for My files, when the list knows it.
export function markItems(a: Account, items: Item[], parent?: string | null) {
  const d = db()
  const have = snapshot(a.id)
  for (const item of items) {
    if (have.rootOf.has(item.id)) continue
    d.runSync("INSERT OR IGNORE INTO offline_marks(account,id,added,parent) VALUES(?,?,?,?)", a.id, item.id, Date.now(), parent ?? null)
    insertItem(a.id, item, parent ?? null, item.id)
  }
  emit(a.id)
  return refreshAll({ manual: true, only: a.id }).catch(() => {})
}

function dropFile(path: string) {
  try {
    const f = new File(`file://${path}`)
    if (f.exists) f.delete()
  } catch {}
}

function dropRoot(account: string, root: string) {
  const d = db()
  for (const f of d.getAllSync<{ path: string }>("SELECT path FROM offline_files WHERE account=? AND root=?", account, root)) dropFile(f.path)
  d.runSync("DELETE FROM offline_files WHERE account=? AND root=?", account, root)
  d.runSync("DELETE FROM offline_items WHERE account=? AND root=?", account, root)
  d.runSync("DELETE FROM offline_marks WHERE account=? AND id=?", account, root)
}

export function unmark(account: string, ids: string[]) {
  for (const id of ids) dropRoot(account, id)
  emit(account)
  tellNative(account)
}

export function removeAll(account: string) {
  for (const r of snapshot(account).roots) dropRoot(account, r.id)
  const dir = offlineFolder(account)
  if (dir.exists) dir.delete()
  emit(account)
  tellNative(account)
}

// Sign-out: this account's copies, lists and waiting changes all go.
export function forgetAccount(account: string) {
  const d = db()
  const dir = offlineFolder(account)
  if (dir.exists) dir.delete()
  for (const t of ["offline_files", "offline_marks", "offline_items", "queue", "failed", "temp_ids", "qcache"])
    d.runSync(`DELETE FROM ${t} WHERE account=?`, account)
  Storage.removeItemSync(`offline.last.${account}`)
  emit(account)
  tellNative(account)
}

// ---- Refresh ----

const call = <T>(a: Account, path: string) => json<T>(a.server, `/api/v1${path}`, { token: a.token })
const gone = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 403)

type Report = { lost: string[]; skipped: number; failed: number; downloaded: number }

async function walk(a: Account, root: Item) {
  const out: { item: Item; parent: string }[] = []
  const todo = [root.id]
  while (todo.length) {
    const folder = todo.shift()!
    let cursor: string | undefined
    try {
      do {
        const page = await call<{ items: Item[]; nextCursor: string | null }>(a, `/folders/${folder}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
        for (const item of page.items) {
          if (item.shortcut) continue
          out.push({ item, parent: folder })
          if (item.kind === "folder") todo.push(item.id)
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor)
    } catch (e) {
      // A subfolder that went away just drops out; the marked one going away is the caller's news.
      if (folder === root.id || !gone(e)) throw e
    }
  }
  return out
}

type Known = { id: string; version: string | null; path: string; root: string | null }

async function refreshRoot(a: Account, id: string, budget: { room: number | null }, report: Report) {
  const d = db()
  const was = snapshot(a.id).roots.find((r) => r.id === id)
  const lose = () => {
    dropRoot(a.id, id)
    report.lost.push(was?.name ?? "An item")
  }
  let root: Item | null
  // Where the marked item sits: the server's parentId when it tells us ("root" for My files), else what the list knew.
  let rootParent: string | null = d.getFirstSync<{ parent: string | null }>("SELECT parent FROM offline_marks WHERE account=? AND id=?", a.id, id)?.parent ?? null
  try {
    const got = await call<{ item: Item | null; details: Details & { parentId?: string | null } }>(a, `/items/${id}`)
    root = got.item
    if (got.details && got.details.parentId !== undefined) rootParent = got.details.parentId ?? "root"
  } catch (e) {
    if (gone(e)) return lose()
    throw e
  }
  if (!root || root.trashedAt) return lose()

  let kids: { item: Item; parent: string }[] = []
  if (root.kind === "folder") {
    try {
      kids = await walk(a, root)
    } catch (e) {
      if (gone(e)) return lose()
      throw e
    }
  }
  const files = [root, ...kids.map((k) => k.item)].filter((i) => i.kind === "file")
  const parentOf = new Map<string, string | null>(kids.map((k) => [k.item.id, k.parent]))
  const ids = new Set(files.map((f) => f.id))
  const known = d.getAllSync<Known>("SELECT id, version, path, root FROM offline_files WHERE account=?", a.id).filter((k) => k.root === id || ids.has(k.id))
  const plan = planRefresh(known, files, budget.room)
  report.skipped += plan.skipped.length

  d.withTransactionSync(() => {
    d.runSync("DELETE FROM offline_items WHERE account=? AND root=?", a.id, id)
    insertItem(a.id, root!, rootParent, id)
    for (const k of kids) {
      insertItem(a.id, k.item, k.parent, id)
      // A mark inside this folder is now covered by it.
      d.runSync("DELETE FROM offline_marks WHERE account=? AND id=?", a.id, k.item.id)
    }
    for (const f of files)
      d.runSync("UPDATE offline_files SET name=?, mime=?, parent=?, root=? WHERE account=? AND id=?", f.name, f.mime, parentOf.get(f.id) ?? rootParent, id, a.id, f.id)
    for (const r of plan.remove) {
      if (r.root !== id) continue
      dropFile(r.path)
      d.runSync("DELETE FROM offline_files WHERE account=? AND id=?", a.id, r.id)
    }
  })
  emit(a.id)

  for (const f of plan.download) {
    const dest = offlineFile(a.id, f.id, f.version)
    try {
      setStatus({ running: true, text: f.name })
      if (!dest.exists) await fetchTo(dest, async () => (await call<PreviewResponse>(a, `/items/${f.id}/preview`)).url)
      const old = known.find((k) => k.id === f.id)
      d.runSync(
        "INSERT OR REPLACE INTO offline_files(account,id,version,name,mime,size,path,parent,root) VALUES(?,?,?,?,?,?,?,?,?)",
        a.id, f.id, f.version, f.name, f.mime, f.size, dest.uri.replace(/^file:\/\//, ""), parentOf.get(f.id) ?? rootParent, id
      )
      if (old && old.path !== dest.uri.replace(/^file:\/\//, "")) dropFile(old.path)
      report.downloaded++
      emit(a.id)
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) throw e
      if (e instanceof ApiError) {
        if (e.status === 0) throw e
        if (!gone(e)) report.failed++
      } else if (/network|connect|timeout|resolve|offline/i.test(String((e as Error)?.message))) {
        throw new ApiError(0, "offline", "Can't reach the server.")
      } else report.failed++
    }
    if (budget.room !== null) budget.room -= f.size
  }
}

async function networkOk(manual: boolean) {
  const n = await Network.getNetworkStateAsync().catch(() => null)
  if (!n || n.isConnected === false || n.isInternetReachable === false) return false
  return manual || getCellular() || n.type !== Network.NetworkStateType.CELLULAR
}

export async function savedAccounts(): Promise<Account[]> {
  const s = await SecureStore.getItemAsync("accounts.v1")
  return s ? (JSON.parse(s).accounts as Account[]) : []
}

// Re-lists every marked item and brings the copies up to date. Opening the app and the background task
// call it without `manual`, which waits for Wi-Fi unless mobile data is allowed. Returns false when it
// didn't run.
export async function refreshAll(opts: { manual?: boolean; only?: string } = {}) {
  if (status.running) return false
  if (!(await networkOk(!!opts.manual))) return false
  setStatus({ running: true, text: null })
  try {
    for (const a of await savedAccounts()) {
      if (opts.only && a.id !== opts.only) continue
      const marks = db().getAllSync<{ id: string }>("SELECT id FROM offline_marks WHERE account=?", a.id)
      if (!marks.length) continue
      const cap = getCap()
      const report: Report = { lost: [], skipped: 0, failed: 0, downloaded: 0 }
      const budget = { room: cap === null ? null : Math.max(0, cap - snapshot(a.id).bytes) }
      try {
        for (const m of marks) await refreshRoot(a, m.id, budget, report)
        Storage.setItemSync(`offline.last.${a.id}`, String(Date.now()))
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) break
        // 401 and the like: this account's turn is over; the others carry on.
      }
      if (report.lost.length)
        addNotice(report.lost.length === 1 ? `“${report.lost[0]}” is no longer available offline. It was deleted or you lost access.` : `${report.lost.length} items are no longer available offline. They were deleted or you lost access.`)
      if (report.skipped) addNotice(`Your offline limit is full, so ${report.skipped} file${report.skipped === 1 ? " wasn't" : "s weren't"} downloaded.`)
      emit(a.id)
      tellNative(a.id)
    }
    return true
  } finally {
    setStatus({ running: false, text: null })
  }
}
