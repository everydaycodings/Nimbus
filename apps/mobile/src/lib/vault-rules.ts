// Vault rules that need no keys: the tree as a listing, names, clashes. No React or native imports, so node --test can run them.
// The server only sees ciphertext, so the checks it does for My files are done here (web: components/vault-browser.tsx).
import type { Conflict } from "@nimbus/shared/api"
import { freeName } from "@nimbus/shared/file-rules"

// packages/shared/vault-crypto.ts, which can't load here (it needs WebCrypto at import).
const CIPHER_CHUNK = 4 * 1024 * 1024 + 16
export const plainSize = (cipher: number) => cipher - 16 * Math.max(1, Math.ceil(cipher / CIPHER_CHUNK))

export type VaultEntry = {
  id: string
  parentId: string | null
  kind: "file" | "folder"
  name: string
  mime: string | null
  // Plaintext bytes; 0 for a folder.
  size: number
  updatedAt: string
  trashedAt: string | null
  encKey: string | null
}

export const lower = (s: string) => s.toLowerCase()

export const live = (all: VaultEntry[]) => all.filter((e) => !e.trashedAt)
export const kidsOf = (all: VaultEntry[], parent: string | null) => all.filter((e) => !e.trashedAt && e.parentId === parent)

// What went into the trash together shares a timestamp; the trash lists the tops.
export function trashRoots(all: VaultEntry[]) {
  const by = new Map(all.map((e) => [e.id, e]))
  return all.filter((e) => e.trashedAt && by.get(e.parentId ?? "")?.trashedAt !== e.trashedAt)
}

// Folders first, then by the chosen order. Name sorts numbers as numbers, like the web.
export function sorted(list: VaultEntry[], sort: "name" | "date" | "size", order: "asc" | "desc") {
  const dir = order === "asc" ? 1 : -1
  return [...list].sort(
    (a, b) =>
      Number(b.kind === "folder") - Number(a.kind === "folder") ||
      dir *
        (sort === "name"
          ? a.name.localeCompare(b.name, undefined, { numeric: true })
          : sort === "size"
            ? a.size - b.size
            : a.updatedAt < b.updatedAt
              ? -1
              : a.updatedAt > b.updatedAt
                ? 1
                : 0)
  )
}

// A name filter looks through the whole vault, like the web's.
export const filtered = (list: VaultEntry[], q: string) => {
  const needle = lower(q.trim())
  return needle ? list.filter((e) => lower(e.name).includes(needle)) : list
}

// The folder's ancestors then itself, for the breadcrumb.
export function pathTo(all: VaultEntry[], id: string | null) {
  const by = new Map(all.map((e) => [e.id, e]))
  const out: VaultEntry[] = []
  for (let p = id; p; p = by.get(p)?.parentId ?? null) {
    const n = by.get(p)
    if (!n) break
    out.unshift(n)
  }
  return out
}

export function nameError(raw: string, siblings: VaultEntry[], selfId?: string) {
  const name = raw.trim()
  if (!name) return "Enter a name."
  if (name.length > 255) return "Keep names under 255 characters."
  if (name === "." || name === ".." || /[/\\\0]/.test(name)) return "Names can't be . or .. or contain / or \\."
  if (siblings.some((s) => s.id !== selfId && lower(s.name) === lower(name))) return "Something with that name is already in this folder."
  return null
}

// Everything under the chosen items, each with its path from them: for ZIP and Move out.
export function withPaths(all: VaultEntry[], roots: VaultEntry[]) {
  const out: { entry: VaultEntry; path: string }[] = []
  const walk = (e: VaultEntry, path: string) => {
    out.push({ entry: e, path })
    if (e.kind === "folder") for (const k of kidsOf(all, e.id)) walk(k, `${path}/${k.name}`)
  }
  for (const r of roots) walk(r, r.name)
  return out
}

// A file to send: no uri means an empty folder.
type Sendable = { path: string; uri?: string }

// Clashes with what's in the target folder. Different kinds are renamed on the spot; same kinds ask.
// `existing` maps a conflict's path to the node it would replace or merge into.
export function planClashes<T extends Sendable>(all: VaultEntry[], target: string | null, entries: T[]) {
  let list = entries
  const named = (pid: string | null, name: string) => kidsOf(all, pid).find((k) => lower(k.name) === lower(name))
  const taken = (pid: string | null) => new Set(kidsOf(all, pid).map((k) => lower(k.name)))
  const renameTop = (from: string, to: string) => {
    list = list.map((i) => (i.path === from || i.path.startsWith(`${from}/`) ? { ...i, path: to + i.path.slice(from.length) } : i))
  }
  const conflicts: Conflict[] = []
  const existing = new Map<string, string>()
  const tops = new Map<string, "file" | "folder">()
  for (const i of list) {
    const [first, ...rest] = i.path.split("/")
    tops.set(first, rest.length || !i.uri ? "folder" : "file")
  }
  for (const [name, kind] of tops) {
    const ex = named(target, name)
    if (!ex) continue
    const free = freeName(name, taken(target), kind === "folder")
    if (ex.kind !== kind) renameTop(name, free)
    else {
      conflicts.push({ path: name, kind, freeName: free })
      existing.set(name, ex.id)
    }
  }
  // Files inside folders that would merge into existing ones.
  for (const i of entries) {
    if (!i.uri || !i.path.includes("/")) continue
    const names = i.path.split("/")
    const file = names.pop()!
    let pid: string | null = target
    for (const d of names) {
      const ex = named(pid, d)
      pid = ex?.kind === "folder" ? ex.id : null
      if (!pid) break
    }
    const ex = pid && named(pid, file)
    if (ex && ex.kind === "file") {
      conflicts.push({ path: i.path, kind: "file", freeName: freeName(file, taken(pid)) })
      existing.set(i.path, ex.id)
    }
  }
  return { list, conflicts, existing }
}

// "Keep both" on a file: the new file takes the free name. Replace and Skip are handled by the caller.
export function renameKept<T extends Sendable>(list: T[], conflicts: Conflict[], answers: Map<string, string>) {
  let out = list
  for (const c of conflicts) {
    if (c.kind !== "file" || answers.get(c.path) !== "keep") continue
    const dir = c.path.slice(0, c.path.lastIndexOf("/") + 1)
    out = out.map((i) => (i.path === c.path ? { ...i, path: dir + c.freeName } : i))
  }
  return out
}

// The folders an upload needs, parents first, and which of them already exist. `make.parent` is a node id,
// or the key (path) of a folder made in the same request.
export function foldersNeeded(all: VaultEntry[], target: string | null, list: Sendable[]) {
  const dirs = new Set<string>()
  for (const i of list) {
    const parts = i.path.split("/")
    for (let k = 1; k <= parts.length - (i.uri ? 1 : 0); k++) dirs.add(parts.slice(0, k).join("/"))
  }
  const ids = new Map<string, string | null>([["", target]])
  const make: { key: string; parent: string | null; name: string }[] = []
  for (const d of [...dirs].sort((a, b) => a.split("/").length - b.split("/").length)) {
    const cut = d.lastIndexOf("/")
    const parentPath = cut < 0 ? "" : d.slice(0, cut)
    const name = d.slice(cut + 1)
    const pid = ids.get(parentPath)
    const ex = pid !== undefined ? kidsOf(all, pid).find((k) => lower(k.name) === lower(name)) : undefined
    if (ex?.kind === "folder") ids.set(d, ex.id)
    else make.push({ key: d, parent: pid !== undefined ? pid : parentPath, name })
  }
  return { ids, make }
}

// ---- When vaults lock themselves ----

export const AWAY_MS = 30_000
// `last`: the last touch; `since`: when the app went to the background (0: it didn't).
export const idleExpired = (now: number, last: number, minutes: number) => now - last > minutes * 60_000
export const awayExpired = (now: number, since: number) => since > 0 && now - since >= AWAY_MS
