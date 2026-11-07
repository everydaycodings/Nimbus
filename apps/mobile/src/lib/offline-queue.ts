// Changes made with no connection: kept in SQLite, shown at once on screen, and replayed in order
// when the server is back. The rules (what may wait, what to do with an error) are in offline-rules.ts.
import type { Item } from "@nimbus/shared/api"
import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"

import { ApiError, json, type Account } from "./api"
import { db } from "./offline-db"
import { idsOf, remap, renamed, classify, unresolved, type Op } from "./offline-rules"
import { savedAccounts, tellNative } from "./offline"
import { CHANGED, currentOf, uploadText } from "./editor-save"

export type Failed = { id: number; op: Op; label: string; error: string; created: number }
type Snap = { waiting: number; pending: Set<string>; ops: Op[]; failed: Failed[] }

const snaps = new Map<string, Snap>()
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
function emit(account: string) {
  snaps.delete(account)
  listeners.forEach((fn) => fn())
}

function load(account: string): Snap {
  const d = db()
  const rows = d.getAllSync<{ op: string }>("SELECT op FROM queue WHERE account=? ORDER BY seq", account)
  const pending = new Set<string>()
  const ops: Op[] = []
  for (const r of rows) {
    const op: Op = JSON.parse(r.op)
    ops.push(op)
    idsOf(op).forEach((i) => pending.add(i))
    if (op.op === "newFolder") pending.add(op.tempId)
  }
  const failed = d
    .getAllSync<{ id: number; op: string; label: string; error: string; created: number }>("SELECT id, op, label, error, created FROM failed WHERE account=? ORDER BY id", account)
    .map((r) => ({ ...r, op: JSON.parse(r.op) as Op }))
  return { waiting: rows.length, pending, ops, failed }
}

export const queueState = (account: string) => {
  let s = snaps.get(account)
  if (!s) snaps.set(account, (s = load(account)))
  return s
}
export const useQueue = (account: string) => useSyncExternalStore(subscribe, () => queueState(account))

export function enqueue(account: string, op: Op, label: string) {
  db().runSync("INSERT INTO queue(account,op,label,created) VALUES(?,?,?,?)", account, JSON.stringify(op), label, Date.now())
  emit(account)
}

// ---- Showing a change before the server has it ----

type Page = { items: Item[] }
const pathOf = (key: readonly unknown[]) => String(key[2])

function patchLists(client: QueryClient, account: string, fn: (items: Item[], path: string, first: boolean) => Item[]) {
  for (const q of client.getQueryCache().findAll({ queryKey: [account, "list"] })) {
    client.setQueryData<InfiniteData<Page>>(q.queryKey, (old) =>
      old && { ...old, pages: old.pages.map((p, i) => ({ ...p, items: fn(p.items, pathOf(q.queryKey), i === 0) })) }
    )
  }
}

// What a waiting change does to one list (`path` is its API path), so lists show it before the server has it.
export function applyOp(items: Item[], path: string, first: boolean, op: Op): Item[] {
  const isTree = path === "/files" || path.startsWith("/folders/")
  switch (op.op) {
    case "rename":
      return items.map((i) => (i.id === op.id ? { ...i, name: op.name } : i))
    case "star": {
      const mapped = items.map((i) => (op.ids.includes(i.id) ? { ...i, starred: op.starred } : i))
      return !op.starred && path === "/starred" ? mapped.filter((i) => !op.ids.includes(i.id)) : mapped
    }
    case "trash":
      return path === "/trash" ? items : items.filter((i) => !op.ids.includes(i.id))
    case "restore":
      return path === "/trash" ? items.filter((i) => !op.ids.includes(i.id)) : items
    case "move": {
      const dest = op.parentId ? `/folders/${op.parentId}` : "/files"
      return isTree && path !== dest ? items.filter((i) => !op.ids.includes(i.id)) : items
    }
    case "applyTag":
      return items.map((i) =>
        !op.ids.includes(i.id) ? i : { ...i, tags: op.on ? [...new Set([...i.tags, op.tagId])] : i.tags.filter((t) => t !== op.tagId) }
      )
    case "newFolder": {
      const dest = op.parentId ? `/folders/${op.parentId}` : "/files"
      const folder: Item = {
        id: op.tempId, kind: "folder", name: op.name, size: 0, mime: null, starred: false, updatedAt: new Date().toISOString(),
        trashedAt: null, tags: [], version: null, thumb: null, sharedWithPeople: false, hasLink: false,
      }
      return path === dest && first ? [folder, ...items] : items
    }
  }
  return items
}

export function showOptimistically(client: QueryClient, account: string, op: Op) {
  patchLists(client, account, (items, path, first) => applyOp(items, path, first, op))
}

// ---- Replay ----

async function exec(a: Account, op: Op): Promise<string | void> {
  const send = <T>(method: string, path: string, body: unknown) =>
    json<T>(a.server, `/api/v1${path}`, { method, token: a.token, body: JSON.stringify(body) })
  switch (op.op) {
    case "rename":
      return void (await send("PATCH", `/items/${op.id}`, { name: op.name }))
    case "move":
      return void (await send("POST", "/items/move", { ids: op.ids, parentId: op.parentId }))
    case "star":
      return void (await send("POST", "/items/star", { ids: op.ids, starred: op.starred }))
    case "trash":
      return void (await send("POST", "/items/trash", { ids: op.ids }))
    case "restore":
      return void (await send("POST", "/items/restore", { ids: op.ids }))
    case "applyTag":
      return void (await send("POST", "/tags/apply", { ids: op.ids, tagId: op.tagId, on: op.on }))
    case "newFolder":
      return (await send<{ id: string }>("POST", "/folders", { parentId: op.parentId, name: op.name })).id
    case "saveText": {
      // The server's copy wins: if it moved on, this goes to Couldn't sync with the text still in it.
      const now = (await currentOf(a, op.id)).item
      if (!now || now.trashedAt || now.version !== op.base) throw new ApiError(409, "changed", CHANGED)
      return void (await uploadText(a, op.parentId, now.name, op.text, "version"))
    }
  }
}

let running = false

// Runs each account's waiting changes in order. A change the server refuses goes to Couldn't sync and the
// rest carry on; a network or server error stops that account's turn, leaving everything for next time.
export async function replay(only?: string[]) {
  if (running) return { done: 0, failed: 0 }
  running = true
  const result = { done: 0, failed: 0 }
  const d = db()
  try {
    for (const a of await savedAccounts()) {
      if (only && !only.includes(a.id)) continue
      const real = Object.fromEntries(d.getAllSync<{ temp: string; real: string }>("SELECT temp, real FROM temp_ids WHERE account=?", a.id).map((r) => [r.temp, r.real]))
      const rows = d.getAllSync<{ seq: number; op: string; label: string }>("SELECT seq, op, label FROM queue WHERE account=? ORDER BY seq", a.id)
      let touched = false
      for (const row of rows) {
        let op: Op = JSON.parse(row.op)
        const fail = (error: string) => {
          d.runSync("INSERT INTO failed(account,op,label,error,created) VALUES(?,?,?,?,?)", a.id, JSON.stringify(op), row.label, error, Date.now())
          d.runSync("DELETE FROM queue WHERE seq=?", row.seq)
          result.failed++
          touched = true
        }
        if (unresolved(op, real)) {
          fail("The folder it needed couldn't be created.")
          continue
        }
        op = remap(op, real)
        let stop = false
        for (;;) {
          try {
            const made = await exec(a, op)
            if (op.op === "newFolder" && made) {
              real[op.tempId] = made
              d.runSync("INSERT OR REPLACE INTO temp_ids(account,temp,real) VALUES(?,?,?)", a.id, op.tempId, made)
            }
            d.runSync("DELETE FROM queue WHERE seq=?", row.seq)
            result.done++
            touched = true
          } catch (e) {
            const err = e instanceof ApiError ? e : new ApiError(0, "offline", "")
            const outcome = classify(op, err)
            if (outcome === "rename") {
              op = renamed(op)
              d.runSync("UPDATE queue SET op=? WHERE seq=?", JSON.stringify(op), row.seq)
              continue
            }
            if (outcome === "retry") stop = true
            else fail(err.message)
          }
          break
        }
        if (stop) break
      }
      if (touched) {
        emit(a.id)
        tellNative(a.id)
      }
    }
  } finally {
    running = false
  }
  return result
}

export function retryFailed(account: string, id: number) {
  const d = db()
  const row = d.getFirstSync<{ op: string; label: string }>("SELECT op, label FROM failed WHERE id=?", id)
  if (!row) return
  d.runSync("DELETE FROM failed WHERE id=?", id)
  d.runSync("INSERT INTO queue(account,op,label,created) VALUES(?,?,?,?)", account, row.op, row.label, Date.now())
  emit(account)
}

export function discardFailed(account: string, id: number) {
  db().runSync("DELETE FROM failed WHERE id=?", id)
  emit(account)
}
