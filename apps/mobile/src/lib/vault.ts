// The phone's side of Vaults. The keys live in Kotlin (native.ts has the contract); JS only ever sees plain names and handles.
import type { Item, VaultFileResponse, VaultNode, VaultsResponse } from "@nimbus/shared/api"
import { useQuery } from "@tanstack/react-query"
import { Directory, File } from "expo-file-system"
import { useFocusEffect } from "expo-router"
import { useCallback, useEffect, useRef, useState } from "react"

import { errorText } from "./api"
import { useApi } from "./files"
import { native, type NativeJob, type NimbusAndroid } from "./native"
import type { Entry, UploadRow } from "./upload-plan"
import { engine } from "./uploads"
import { plainSize, type VaultEntry } from "./vault-rules"

const NEEDED = [
  "vaultCreate", "vaultAdopt", "vaultUnlock", "vaultRewrap", "vaultLock", "vaultLockAll", "vaultIsOpen", "vaultOpenNames", "vaultSealName",
  "vaultNameTags", "vaultCacheDir", "vaultDecrypt", "vaultZip", "vaultCancel", "vaultBioAvailable", "vaultBioEnabled", "vaultBioEnable",
  "vaultBioUnlock", "vaultBioDisable", "vaultForget", "setSecure",
] as const

export type VaultNative = NimbusAndroid & Required<Pick<NimbusAndroid, (typeof NEEDED)[number]>>

// Null in Expo Go and in an APK from before Phase 7.
export const vaultNative: VaultNative | null =
  native && NEEDED.every((k) => typeof (native as unknown as Record<string, unknown>)[k] === "function") ? (native as VaultNative) : null

type Api = ReturnType<typeof useApi>

export function useVaults() {
  const api = useApi()
  return useQuery({ queryKey: [api.id, "vaults"], queryFn: () => api.get<VaultsResponse>("/vaults") })
}

// The Files components take Items; a vault entry is one without stars, tags, sharing or a thumbnail.
export const toItem = (e: VaultEntry): Item => ({
  id: e.id, kind: e.kind, name: e.name, size: e.size, mime: e.mime, starred: false, updatedAt: e.updatedAt, trashedAt: e.trashedAt,
  tags: [], version: null, thumb: null, sharedWithPeople: false, hasLink: false,
})

// The tree with names opened. Names with no tag yet get theirs now (the web does the same).
export async function loadTree(api: Api, vn: VaultNative, vaultId: string): Promise<VaultEntry[]> {
  const { nodes } = await api.get<{ nodes: VaultNode[] }>(`/vaults/${vaultId}/tree`)
  const opened: ({ n: string; t: string | null } | null)[] = JSON.parse(await vn.vaultOpenNames(api.id, vaultId, nodes.map((n) => n.name)))
  const entries = nodes.map<VaultEntry>((n, i) => ({
    id: n.id,
    parentId: n.parentId,
    kind: n.kind,
    name: opened[i]?.n ?? "Unreadable item",
    mime: opened[i]?.t ?? null,
    size: n.kind === "file" ? plainSize(n.size) : 0,
    updatedAt: n.updatedAt,
    trashedAt: n.trashedAt,
    encKey: n.encKey,
  }))
  const untagged = entries.filter((e, i) => opened[i] && !nodes[i].tagged)
  if (untagged.length) {
    const tags: string[] = JSON.parse(await vn.vaultNameTags(api.id, vaultId, untagged.map((e) => e.name)))
    api.post(`/vaults/${vaultId}/tags`, { tags: untagged.map((e, i) => ({ id: e.id, tag: tags[i] })) }).catch(() => {})
  }
  return entries
}

// Not a TanStack query: those are saved to disk, and these are names.
export function useVaultTree(vaultId: string, vn: VaultNative) {
  const api = useApi()
  const [entries, setEntries] = useState<VaultEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const reload = useCallback(async () => {
    try {
      setEntries(await loadTree(api, vn, vaultId))
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }, [api, vn, vaultId])
  // On every focus: the trash screen and the browser each hold their own copy of the tree.
  useFocusEffect(
    useCallback(() => {
      reload()
    }, [reload])
  )
  // Finished uploads come in bursts; reload once they settle.
  const soon = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(reload, 500)
  }, [reload])
  useEffect(() => () => clearTimeout(timer.current), [])
  return { entries, error, reload, soon }
}

// ---- Decrypting ----

let jobs = 0
const newJob = () => `vault-${Date.now()}-${jobs++}`
export const cancelled = (e: unknown) => e instanceof Error && /cancel|abort/i.test(e.message)

const fileInfo = (api: Api, vaultId: string, nodeId: string) => api.get<VaultFileResponse>(`/vaults/${vaultId}/files/${nodeId}`)

// Kotlin takes a plain path or a content:// URI; expo-file-system hands out file:// URIs.
const nativeDest = (dest: string) => (dest.startsWith("file://") ? decodeURIComponent(dest.slice(7)) : dest)
// And the other way: expo-file-system needs a file:// URI for Kotlin's plain paths.
export const vaultDirUri = (vn: VaultNative, accountId: string, vaultId: string) => `file://${vn.vaultCacheDir(accountId, vaultId)}`

async function run(vn: VaultNative, start: (jobId: string) => Promise<void>, onProgress?: (done: number, total: number) => void, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("cancelled")
  const jobId = newJob()
  const sub = vn.addListener("vault", (e) => {
    if (e.jobId === jobId) onProgress?.(e.done ?? 0, e.total ?? 0)
  })
  const stop = () => vn.vaultCancel(jobId)
  signal?.addEventListener("abort", stop)
  try {
    await start(jobId)
  } finally {
    sub.remove()
    signal?.removeEventListener("abort", stop)
  }
}

// `dest`: a path, or a content:// URI from Android's folder picker.
export async function decryptTo(api: Api, vn: VaultNative, vaultId: string, nodeId: string, dest: string, onProgress?: (done: number, total: number) => void, signal?: AbortSignal) {
  const f = await fileInfo(api, vaultId, nodeId)
  await run(vn, (job) => vn.vaultDecrypt(job, api.id, vaultId, f.url, f.encKey, nativeDest(dest)), onProgress, signal)
}

export async function zipTo(api: Api, vn: VaultNative, vaultId: string, files: { id: string; path: string }[], dest: string, onProgress?: (done: number, total: number) => void, signal?: AbortSignal) {
  // size is the ciphertext size, so progress has a real total.
  const items: { url: string; encKey: string; path: string; size: number }[] = []
  for (let i = 0; i < files.length; i += 6) {
    const got = await Promise.all(
      files.slice(i, i + 6).map(async (f) => {
        const { url, encKey, size } = await fileInfo(api, vaultId, f.id)
        return { url, encKey, path: f.path, size }
      })
    )
    items.push(...got)
  }
  await run(vn, (job) => vn.vaultZip(job, api.id, vaultId, JSON.stringify(items), nativeDest(dest)), onProgress, signal)
}

// A plain copy for a viewer or another app. Kotlin deletes the folder on lock; the previewer deletes it on close.
export function vaultTemp(vn: VaultNative, api: Api, vaultId: string, item: Pick<Item, "id" | "name">) {
  // Under its own name, so an app opening it with Open with shows the real name; the id folder keeps it unique.
  return new File(new Directory(vaultDirUri(vn, api.id, vaultId), item.id), item.name)
}

const pending = new Map<string, Promise<File>>()
export function decryptTemp(api: Api, vn: VaultNative, vaultId: string, item: Item, onProgress?: (done: number, total: number) => void, signal?: AbortSignal) {
  const file = vaultTemp(vn, api, vaultId, item)
  if (file.exists && file.size === item.size) return Promise.resolve(file)
  let p = pending.get(file.uri)
  if (!p) {
    p = decryptTo(api, vn, vaultId, item.id, file.uri, onProgress, signal).then(() => file)
    pending.set(file.uri, p)
    p.then(() => pending.delete(file.uri), () => pending.delete(file.uri))
  }
  return p
}

// ---- Waiting for uploads ----

export const knownRows = () => new Set(engine.rows().map((r) => r.id))

// True once `count` new rows matching `match` are done; false if one of them goes away unfinished (cancelled).
// A failed row just keeps this waiting, so the originals stay until it's retried.
export function awaitDone(accountId: string, match: (r: UploadRow) => boolean, known: Set<string>, count: number) {
  return new Promise<boolean>((resolve) => {
    const seen = new Set<string>()
    const done = new Set<string>()
    const check = () => {
      const mine = engine.rows().filter((r) => r.accountId === accountId && !known.has(r.id) && match(r))
      for (const r of mine) {
        seen.add(r.id)
        if (r.status === "done") done.add(r.id)
      }
      if ([...seen].some((id) => !done.has(id) && !mine.some((r) => r.id === id))) off(), resolve(false)
      else if (done.size >= count) off(), resolve(true)
    }
    const off = engine.subscribe(check)
    check()
  })
}

// ---- Where the person was going when they had to unlock first ----

export type Intake = { vaultId: string; items?: Item[]; files?: Entry[]; exit?: boolean }
let waiting: Intake | null = null
export const setIntake = (i: Intake | null) => void (waiting = i)
export function takeIntake(vaultId: string) {
  if (waiting?.vaultId !== vaultId) return null
  const i = waiting
  waiting = null
  return i
}

// ---- Retrying ----

// A vault row can't resume once it has failed for good: its file key is gone. Retry plans and seals again from what
// was queued, which only this session remembers.
const queued = new Map<string, NativeJob>()
const jobKey = (account: string, vaultId: string, name: string, size: number) => `${account}\n${vaultId}\n${name}\n${size}`
export const rememberJobs = (jobs: NativeJob[]) => jobs.forEach((j) => j.vault && queued.set(jobKey(j.accountId, j.vault.vaultId, j.name, j.size), j))

// Not enough space is the phone's, and retries like any upload.
export const needsReplan = (r: UploadRow) => !!r.vaultId && r.status === "failed" && !/space/i.test(r.error ?? "")

// The reason it couldn't, or null when it's queued again.
export async function retryVaultRow(api: Api, vn: VaultNative, row: UploadRow): Promise<string | null> {
  const job = row.vaultId ? queued.get(jobKey(row.accountId, row.vaultId, row.name, row.size)) : undefined
  if (!row.vaultId || !vn.vaultIsOpen(api.id, row.vaultId)) return "Open the vault and try again."
  if (!job?.vault) return "Open the vault and add this file again."
  try {
    const sealed = JSON.parse(await vn.vaultSealName(api.id, row.vaultId, job.name, job.mime || null)) as { sealed: string; tag: string }
    const plan = await api.post<{ tokens: string[] }>(`/vaults/${row.vaultId}/uploads/plan`, { groups: [{ parentId: job.parentId, sizes: [job.size] }] })
    const next = { ...job, planToken: plan.tokens[0], vault: { ...job.vault, sealedName: sealed.sealed, nameTag: sealed.tag } }
    engine.drop(row.id)
    await engine.add([next], api.account.token)
    queued.set(jobKey(row.accountId, row.vaultId, row.name, row.size), next)
    return null
  } catch (e) {
    return errorText(e)
  }
}

// A previewed file decrypted to a temp copy; `url` is its file:// address once it's ready.
export function useVaultFile(vaultId: string | undefined, item: Item, enabled: boolean) {
  const api = useApi()
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<Error | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled || !vaultId || !vaultNative) return
    let live = true
    decryptTemp(api, vaultNative, vaultId, item).then(
      (f) => live && setUrl(f.uri),
      (e) => live && setError(e instanceof Error ? e : new Error(errorText(e)))
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the file is named by its id; `attempt` retries
  }, [enabled, vaultId, item.id, attempt])
  const refetch = useCallback(() => {
    setError(null)
    setAttempt((n) => n + 1)
  }, [])
  return { url, error, refetch }
}
