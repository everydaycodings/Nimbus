// Picks files, plans them with the server, and hands them to the engine.
import type { Plan } from "@nimbus/shared/api"
import { isDropped, mimeOf } from "@nimbus/shared/file-rules"
import * as DocumentPicker from "expo-document-picker"
import { Directory, File } from "expo-file-system"
import * as ImagePicker from "expo-image-picker"
import { useSyncExternalStore } from "react"

import { json, type Account } from "./api"
import { native, type NativeJob } from "./native"
import { whilePicking } from "./picking"
import { nativeEngine } from "./upload-engine-native"
import { jsEngine } from "./upload-engine-js"
import type { Entry, UploadRow } from "./upload-plan"

export type UploadEngine = {
  rows(): UploadRow[]
  subscribe(fn: () => void): () => void
  add(jobs: NativeJob[], token: string): void | Promise<void>
  refuse(accountId: string, name: string, error: string): void
  pause(id: string): void
  resume(id: string): void
  retry(id: string): void
  cancel(id: string): void
  drop(id: string): void
  // Finished rows go; `everything` also takes the "Same as…" ones still waiting for Keep or Remove.
  clear(accountId: string, everything: boolean): void
  cancelAccount(accountId: string): void
}

export const engine = native ? nativeEngine(native) : jsEngine

const EMPTY: UploadRow[] = []
// Only the account on screen's, so nothing crosses between accounts.
export function useUploadRows(accountId: string | undefined) {
  const rows = useSyncExternalStore(engine.subscribe, engine.rows)
  return accountId ? rows.filter((r) => r.accountId === accountId) : EMPTY
}

export const plan = (account: Account, parentId: string | null, entries: Entry[]) =>
  json<Plan>(account.server, "/api/v1/uploads/plan", {
    method: "POST",
    token: account.token,
    body: JSON.stringify({ parentId, entries: entries.map((e) => ({ path: e.path, size: e.size, ...(e.uri ? {} : { dir: true }) })) }),
  })

// ---- Choosing what to send ----

export const localStamp = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString()
const stamp = () => localStamp().slice(0, 19).replace(/[-:]/g, "").replace("T", "_")

const media = (a: ImagePicker.ImagePickerAsset, name?: string): Entry => {
  // Android's photo picker names files by their library number ("1000000048.jpg"); the library knows the
  // real name when we may ask it.
  const id = a.assetId ?? a.fileName?.match(/^(\d+)\.\w+$/)?.[1]
  const real = id && typeof native?.mediaName === "function" ? native.mediaName(id) : null
  const path = name ?? real ?? a.fileName ?? a.uri.split("/").pop() ?? `Upload_${stamp()}`
  return { path, size: a.fileSize ?? new File(a.uri).size ?? 0, uri: a.uri, mime: mimeOf(a.mimeType ?? null, path) }
}

function walk(dir: Directory, prefix: string, out: Entry[]) {
  const kids = dir.list()
  if (!kids.length) out.push({ path: prefix, size: 0 })
  for (const kid of kids) {
    if (!kid.name) continue
    const path = `${prefix}/${kid.name}`
    if (kid instanceof Directory) walk(kid, path, out)
    else if (!isDropped(kid.name)) out.push({ path, size: kid.size ?? 0, uri: kid.uri, mime: mimeOf(kid.type || null, kid.name) })
  }
}

const pickers = {
  // Not copied to the cache: a 2 GB file would have to fit there first.
  files: async (): Promise<Entry[]> => {
    const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: false })
    if (r.canceled) return []
    return r.assets.map((a) => ({ path: a.name, size: a.size ?? new File(a.uri).size ?? 0, uri: a.uri, mime: mimeOf(a.mimeType ?? null, a.name) }))
  },
  folder: async (): Promise<Entry[]> => {
    let dir: Directory
    try {
      dir = await Directory.pickDirectoryAsync()
    } catch {
      return [] // Backed out of the picker.
    }
    const out: Entry[] = []
    walk(dir, dir.name, out)
    return out
  },
  media: async (): Promise<Entry[]> => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true, quality: 1 })
    return r.canceled ? [] : r.assets.map((a) => media(a))
  },
  // Null: the camera permission was refused.
  camera: async (kind: "images" | "videos"): Promise<Entry[] | null> => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync()
    if (!granted) return null
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: [kind], quality: 1 })
    if (r.canceled) return []
    const a = r.assets[0]
    const ext = a.uri.split(".").pop() ?? (kind === "images" ? "jpg" : "mp4")
    return [media(a, `${kind === "images" ? "IMG" : "VID"}_${stamp()}.${ext}`)]
  },
}
// Each picker counts as "picking", so time spent in it doesn't lock the app or a vault.
export const pick = Object.fromEntries(
  Object.entries(pickers).map(([k, f]) => [k, (...a: unknown[]) => whilePicking(() => (f as (...a: unknown[]) => Promise<unknown>)(...a))])
) as typeof pickers
