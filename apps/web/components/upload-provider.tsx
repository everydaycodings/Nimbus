"use client"

import { Menu } from "@base-ui/react/menu"
import {
  FileArrowUpIcon,
  FolderSimplePlusIcon,
  PlusIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react"
import { usePathname, useRouter } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { IHasher } from "hash-wasm"
import { Upload, type DetailedError } from "tus-js-client"

import { restoreItems, trashItems } from "@/app/(app)/file-actions"
import {
  createFolders,
  finishUpload,
  listVersions,
  planUpload,
} from "@/app/(app)/upload-actions"
import { ConflictDialog, type Answers } from "@/components/conflict-dialog"
import type { Conflict } from "@/app/(app)/upload-actions"
import { MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import { useSidebar } from "@/components/sidebar-shell"
import { useNotice } from "@/components/toaster"
import { UploadPanel } from "@/components/upload-panel"
import { Button } from "@/components/ui/button"
import {
  clientZipDownload,
  zipDownload,
  type ZipManifest,
} from "@/lib/client-zip-download"
import { ensureIndexed } from "@/lib/index-content"
import { ensureThumb } from "@/lib/thumbs"
import { zipName } from "@/lib/file-rules"
import { cn } from "@/lib/utils"
import {
  CHUNK,
  CIPHER_CHUNK,
  cipherSize,
  cipherSlice,
  newFileKey,
  openFileKey,
} from "@/lib/vault-crypto"

// A file, or an empty folder (file null), at a "/"-separated path relative to
// the target folder.
// A file read on demand by byte range instead of from disk: moves into and out
// of a vault stream through these, so nothing is held whole in memory.
export type Lazy = {
  name: string
  type: string
  size: number
  lastModified: number
  read: (start: number, end: number) => Promise<Uint8Array<ArrayBuffer>>
}

export type UploadInput = { file: File | Lazy | null; path: string }

const bytesOf = (f: File | Lazy) =>
  f instanceof Blob
    ? async (s: number, e: number) =>
        new Uint8Array(await f.slice(s, e).arrayBuffer())
    : f.read
type Target = { id: string; kind: "file" | "folder"; name: string }

// OS files and folders from a drop, folders walked recursively. Must be called
// synchronously in the drop handler; the entries die with the event.
export function readDrop(dt: DataTransfer): Promise<UploadInput[]> {
  const roots = [...dt.items]
    .map((i) => i.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => Boolean(e))
  const plain = [...dt.files]
  if (!roots.length)
    return Promise.resolve(plain.map((f) => ({ file: f, path: f.name })))
  const out: UploadInput[] = []
  async function walk(e: FileSystemEntry, prefix: string): Promise<void> {
    const path = prefix + e.name
    if (e.isFile) {
      const file = await new Promise<File>((res, rej) =>
        (e as FileSystemFileEntry).file(res, rej)
      )
      out.push({ file, path })
      return
    }
    const reader = (e as FileSystemDirectoryEntry).createReader()
    const kids: FileSystemEntry[] = []
    // readEntries returns batches (100 in Chromium) until an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
        reader.readEntries(res, rej)
      )
      if (!batch.length) break
      kids.push(...batch)
    }
    if (!kids.length) out.push({ file: null, path })
    for (const k of kids) await walk(k, `${path}/`)
  }
  return Promise.all(roots.map((r) => walk(r, ""))).then(() => out)
}

// Starts a download without navigating, so beforeunload never fires mid-upload.
export function saveUrl(href: string) {
  const a = document.createElement("a")
  a.href = href
  a.download = ""
  a.click()
}

// Clipboard files; a pasted screenshot gets a findable name instead of image.png.
export function pastedFiles(e: ClipboardEvent): UploadInput[] {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
  return [...(e.clipboardData?.files ?? [])].map((f) => {
    const file =
      f.name === "image.png"
        ? new File([f], `Pasted image ${stamp}.png`, {
            type: f.type,
            lastModified: f.lastModified,
          })
        : f
    return { file, path: file.name }
  })
}

export type Job = {
  id: string
  kind: "upload" | "zip"
  name: string
  mime: string
  // The folder it went into, for "show in folder" once done.
  parentId: string | null
  size: number
  sent: number
  status: "queued" | "uploading" | "paused" | "done" | "error"
  error?: string
  // Version number when the upload added a version to an existing file.
  version?: number
  // Refused before upload (too big, blocked type): retrying can't help.
  final?: boolean
  // Went into this vault (parentId is a folder in it).
  vault?: string
  // The file it became, and another of the owner's files with the same bytes.
  nodeId?: string
  duplicateOf?: { id: string; path: string }
}

type Data = {
  file?: File | Lazy
  meta?: Record<string, string>
  fingerprint?: string
  upload?: Upload
  // tus finished; only finishUpload is left (or needs a retry).
  uploaded?: boolean
  abort?: AbortController
  vault?: VaultData
  // Runs once the file has landed.
  onDone?: () => void
  // SHA-256 of the bytes sent so far (see hashSlice); null once it can't be known.
  sha?: Sha | null
}

type Sha = {
  h: IHasher
  at: number
  // The state before the last slice, for when tus sends that slice again.
  last?: { start: number; state: Uint8Array }
  hex?: string
}

// A vault upload: encrypted on the way out, under a file key that's picked
// once and reused on resume, so the bytes already on the server still match.
type VaultData = {
  vk: CryptoKey
  fk?: CryptoKey
  vaultId: string
}

export type VaultJob = {
  file: File | Lazy
  name: string
  // The name's tag, so the server can refuse duplicates (see nameTag).
  nameTag: string
  vaultId: string
  parentId: string | null
  token: string
  sealedName: string
  vk: CryptoKey
  // A same-named file this one takes the place of once it lands (Replace).
  replaces?: string
  onDone: () => void
}

// tus PATCHes this much ciphertext at a time; whole cipher chunks, so each
// slice encrypts only its own chunks.
const VAULT_PART = 16 * CIPHER_CHUNK

// Hands tus ciphertext instead of the file's bytes.
const vaultReader = (v: VaultData) => ({
  async openFile(file: File | Lazy) {
    const size = cipherSize(file.size)
    const read = bytesOf(file)
    return {
      size,
      async slice(start: number, end: number) {
        const bytes = await cipherSlice(v.fk!, file.size, read, start, end)
        // tus sizes the slice by `value.size`, which a Blob has.
        return { value: new Blob([bytes]), done: end >= size }
      },
      close() {},
    }
  },
})

// Plain uploads go a part at a time; a Lazy source is read through this.
const LAZY_PART = 16 * CHUNK
const lazyReader = {
  async openFile(file: Lazy) {
    return {
      size: file.size,
      async slice(start: number, end: number) {
        end = Math.min(end, file.size)
        const bytes = await file.read(start, end)
        return { value: new Blob([bytes]), done: end >= file.size }
      },
      close() {},
    }
  },
}

// Hashes what tus sends, slice by slice in order, for spotting duplicates. A
// slice sent again (a retried PATCH) rewinds to the state saved before it;
// anything else out of order (resuming an earlier visit's upload) drops it.
async function hashSlice(d: Data, start: number, end: number, blob: Blob) {
  if (d.sha === null) return
  if (!d.sha) {
    if (start !== 0) return void (d.sha = null)
    const { createSHA256 } = await import("hash-wasm")
    d.sha = { h: await createSHA256(), at: 0 }
  }
  const s = d.sha
  if (s.last && start === s.last.start) {
    s.h.load(s.last.state)
    s.at = start
  }
  if (start !== s.at) return void (d.sha = null)
  s.last = { start, state: s.h.save() }
  s.h.update(new Uint8Array(await blob.arrayBuffer()))
  s.at = end
}

// When the shared speed cap next has room. Every running upload books its
// slices here, so together they stay under the cap however many run.
let capFree = 0

async function pace(bytes: number, cap: number) {
  const now = performance.now()
  const at = Math.max(now, capFree)
  capFree = at + (bytes / cap) * 1000
  if (at > now) await new Promise((r) => setTimeout(r, at - now))
}

// Plain files go through this to be hashed and, with a speed cap, paced.
const plainReader = (d: Data, cap: number | null) => ({
  async openFile(file: File) {
    return {
      size: file.size,
      async slice(start: number, end: number) {
        end = Math.min(end, file.size)
        const value = file.slice(start, end)
        await hashSlice(d, start, end, value).catch(() => (d.sha = null))
        if (cap) await pace(end - start, cap)
        return { value, done: end >= file.size }
      },
      close() {},
    }
  },
})

async function sha256(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return [...new Uint8Array(h)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

const CONCURRENT = 3
const STORE = "tus::nimbus|"

// Fingerprint the resume flow can read back from localStorage:
// nimbus|<parent>|<size>|<lastModified>|<path>. Path is last since it may hold "|".
const fingerprintOf = (
  parentId: string | null,
  file: File | Lazy,
  path: string
) => `nimbus|${parentId ?? ""}|${file.size}|${file.lastModified}|${path}`

type Stale = {
  key: string
  parentId: string | null
  size: number
  modified: number
  path: string
}

function readStale(): Stale[] {
  const out: Stale[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(STORE)) continue
      const [, parent, size, modified, ...path] = key
        .slice(5, key.lastIndexOf("::"))
        .split("|")
      out.push({
        key,
        parentId: parent || null,
        size: Number(size),
        modified: Number(modified),
        path: path.join("|"),
      })
    }
  } catch {}
  return out
}

// Says why, in words: hook rejections come through as-is; tusd and storage
// failures are reduced to their reason.
function tusError(e: Error) {
  const res = (e as DetailedError).originalResponse
  if (!res)
    return "Couldn't reach the upload server. Check your connection and retry."
  const status = res.getStatus()
  const body = res.getBody()?.trim() ?? ""
  if (/StorageFull|XMinioStorageFull|\b507\b/.test(body) || status === 507)
    return "The storage server is out of disk space. Ask your admin to free some up."
  if (body && body.length < 200 && !body.includes("<"))
    return body.replace(/^ERR_[A-Z_]+:\s*/, "")
  // "...api error NoSuchBucket: The specified bucket does not exist"
  const api = /api error (\w+): ([^\n]+)/.exec(body)
  if (api) return `Storage error: ${api[2].trim()} (${api[1]})`
  return `The upload server failed (HTTP ${status}). Retry, or ask your admin to check its logs.`
}

type State = { jobs: Job[]; stale: Stale[] }
const EMPTY: State = { jobs: [], stale: [] }

// Upload queue outside React: tus callbacks mutate it, the panel subscribes.
class Engine {
  state: State = EMPTY
  private data = new Map<string, Data>()
  private subs = new Set<() => void>()
  private seq = 0
  onFinished = () => {}
  listen(fn: () => void) {
    this.onFinished = fn
  }
  // Bytes a second for the web uploader, or null (see UploadProvider).
  cap: number | null = null

  constructor(private tusUrl: string) {
    if (typeof window !== "undefined")
      this.state = { jobs: [], stale: readStale() }
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn)
    return () => void this.subs.delete(fn)
  }
  get = () => this.state
  getServer = () => EMPTY

  private set(next: Partial<State>) {
    this.state = { ...this.state, ...next }
    for (const fn of this.subs) fn()
  }
  private patch(id: string, p: Partial<Job>) {
    this.set({
      jobs: this.state.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)),
    })
  }
  private job = (id: string) => this.state.jobs.find((j) => j.id === id)

  add(job: Omit<Job, "id" | "sent">, data: Data = {}) {
    const id = String(++this.seq)
    this.data.set(id, data)
    this.set({ jobs: [...this.state.jobs, { ...job, id, sent: 0 }] })
    return id
  }

  fail(name: string, error: string) {
    this.add({
      kind: "upload",
      name,
      mime: "",
      parentId: null,
      size: 0,
      status: "error",
      error,
      final: true,
    })
  }

  pump() {
    let active = this.state.jobs.filter(
      (j) => j.kind === "upload" && j.status === "uploading"
    ).length
    for (const j of this.state.jobs) {
      if (active >= CONCURRENT) break
      if (j.kind !== "upload" || j.status !== "queued") continue
      active++
      this.begin(j.id)
    }
  }

  private begin(id: string) {
    this.patch(id, { status: "uploading", error: undefined })
    const d = this.data.get(id)!
    if (d.uploaded) return this.finish(id)
    if (d.upload) return d.upload.start()
    const v = d.vault
    // A Lazy source can't be picked again after a reload, so it isn't resumable.
    const lazy = !(d.file instanceof Blob)
    // Under a cap, parts of about two seconds each so progress keeps moving.
    // ponytail: parts under 5 MB make tusd rewrite its .part buffer in S3 each
    // time; fine at the low speeds that need them.
    const part = this.cap
      ? Math.min(LAZY_PART, Math.max(256 * 1024, this.cap * 2))
      : LAZY_PART
    const up = new Upload(d.file as File, {
      // Every upload goes in parts: one long PATCH for a big file dies on the
      // first network blip and has to be retried as a whole.
      chunkSize: v ? VAULT_PART : Math.round(part),
      fileReader: v
        ? vaultReader(v)
        : lazy
          ? lazyReader
          : plainReader(d, this.cap),
      endpoint: this.tusUrl,
      // ~3.5 min of retries, so a dropped Wi-Fi or a server restart doesn't fail it.
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000, 60000, 90000],
      storeFingerprintForResuming: !lazy,
      removeFingerprintOnSuccess: true,
      fingerprint: async () => d.fingerprint!,
      metadata: d.meta,
      onProgress: (sent) => this.patch(id, { sent }),
      onError: (e) => {
        this.patch(id, { status: "error", error: tusError(e) })
        this.pump()
      },
      onSuccess: () => {
        d.uploaded = true
        this.finish(id)
      },
    })
    d.upload = up
    up.findPreviousUploads().then(async (prev) => {
      if (v && !v.fk) {
        const old = prev[0]?.metadata?.encKey
        v.fk = old
          ? await openFileKey(v.vk, old).catch(() => undefined)
          : undefined
        if (old && v.fk) up.options.metadata = { ...d.meta, encKey: old }
        else {
          prev = []
          const k = await newFileKey(v.vk)
          v.fk = k.fk
          up.options.metadata = { ...d.meta, encKey: k.wrapped }
        }
      }
      if (prev[0]) up.resumeFromPreviousUpload(prev[0])
      if (this.job(id)?.status === "uploading") up.start()
    })
  }

  private async finish(id: string) {
    const d = this.data.get(id)!
    const file = d.file
    const sha = d.sha
    if (sha && !sha.hex && file && sha.at === file.size)
      sha.hex = sha.h.digest("hex")
    const res: Awaited<ReturnType<typeof finishUpload>> = await finishUpload(
      d.upload!.url!,
      sha?.hex ?? null
    ).catch(() => ({ error: "Uploaded, but Nimbus couldn't save it. Retry." }))
    // A nodeId means it landed, even alongside an error (the tusd hook won).
    if (!res.nodeId) {
      this.patch(id, {
        status: "error",
        error: res.error ?? "Couldn't save it. Retry.",
      })
    } else {
      this.patch(id, {
        status: "done",
        sent: this.job(id)?.size ?? 0,
        nodeId: res.nodeId,
        duplicateOf: res.duplicateOf,
      })
      this.data.set(id, {})
      d.onDone?.()
      // Drawn and indexed from the local copy while it's at hand; failures just
      // leave the icon, and the text gets read on a later visit.
      if (!d.vault && file instanceof Blob && res.versionId) {
        const f = {
          id: res.nodeId,
          version: res.versionId,
          mime: file.type || null,
          name: file.name,
          size: file.size,
        }
        ensureThumb(f, file)
        ensureIndexed(f, file)
      }
      // "v3 added": only worth a lookup when the upload asked for a version.
      if (d.meta?.onConflict === "version")
        listVersions(res.nodeId)
          .then((v) => {
            const n = v.find((x) => x.current)?.number
            if (n && n > 1) this.patch(id, { version: n })
          })
          .catch(() => {})
    }
    this.onFinished()
    this.pump()
  }

  pause(id: string) {
    const j = this.job(id)
    if (j?.status !== "uploading" && j?.status !== "queued") return
    this.data.get(id)?.upload?.abort()
    this.patch(id, { status: "paused" })
  }
  resume(id: string) {
    const j = this.job(id)
    if (j?.status !== "paused" && (j?.status !== "error" || j.final)) return
    this.patch(id, { status: "queued" })
  }
  pauseAll() {
    for (const j of this.state.jobs) if (j.kind === "upload") this.pause(j.id)
  }
  resumeAll() {
    for (const j of this.state.jobs)
      if (j.status === "paused") this.resume(j.id)
    this.pump()
  }

  cancel(id: string) {
    const d = this.data.get(id)
    // abort(true) also deletes the partial upload on the server and its fingerprint.
    d?.upload?.abort(Boolean(d.upload.url)).catch(() => {})
    d?.abort?.abort()
    this.data.delete(id)
    this.set({ jobs: this.state.jobs.filter((j) => j.id !== id) })
    this.pump()
  }

  // Close: drop finished and failed rows. Failed tus uploads keep their
  // fingerprint, so the next visit offers to resume them.
  clear() {
    this.set({ jobs: [] })
    this.data.clear()
  }

  dismissStale() {
    try {
      for (const s of this.state.stale) localStorage.removeItem(s.key)
    } catch {}
    this.set({ stale: [] })
  }
  takeStale() {
    const s = this.state.stale
    this.set({ stale: [] })
    return s
  }

  progress(id: string, sent: number, size: number) {
    this.patch(id, { sent, size })
  }
  end(id: string, error?: string) {
    if (!this.job(id)) return
    this.data.delete(id)
    this.patch(id, error ? { status: "error", error } : { status: "done" })
  }
  keep(id: string) {
    this.patch(id, { duplicateOf: undefined })
  }
  drop(id: string) {
    this.data.delete(id)
    this.set({ jobs: this.state.jobs.filter((j) => j.id !== id) })
  }
}

type Ctx = {
  upload: (
    inputs: UploadInput[],
    parentId: string | null,
    onDone?: () => void
  ) => void
  download: (items: Target[]) => void
  // Vaults plan their own uploads; these queue them and ask about clashes.
  uploadToVault: (jobs: VaultJob[]) => void
  ask: (conflicts: Conflict[], replace?: boolean) => Promise<Answers | null>
  // An open vault takes what the pickers return, so nothing lands in My files.
  claimPicks: (fn: (inputs: UploadInput[]) => void) => () => void
  // Transfers still running, and a way to reload without the leave-page prompt
  // (switching accounts asks first).
  busy: () => number
  leave: () => void
  // A zip of decrypted vault files, built in this browser.
  zipVault: (
    name: string,
    load: (signal: AbortSignal) => Promise<ZipManifest>
  ) => void
}
const UploadContext = createContext<Ctx>({
  upload() {},
  download() {},
  uploadToVault() {},
  ask: async () => null,
  claimPicks: () => () => {},
  zipVault() {},
  busy: () => 0,
  leave() {},
})
export const useUploads = () => useContext(UploadContext)

let asks = 0
let leaving = false
const running = (j: Job) => j.status === "uploading" || j.status === "queued"

// Sidebar "New folder" outside a folder view opens My files, then the dialog.
let wantsNewFolder = false
export function takeNewFolderRequest() {
  const w = wantsNewFolder
  wantsNewFolder = false
  return w
}

const parentFromPath = (path: string) =>
  path.startsWith("/folders/") ? path.split("/")[2] : null

export function UploadProvider({
  tusUrl,
  zipMode,
  speedCap,
  children,
}: {
  tusUrl: string
  zipMode: "server" | "client"
  // The member's upload speed cap in bytes a second; null for none.
  speedCap: number | null
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [engine] = useState(() => new Engine(tusUrl))
  // Read when each upload starts.
  useEffect(() => {
    engine.cap = speedCap
  }, [engine, speedCap])
  const askQueue = useRef(Promise.resolve())
  const [asking, setAsking] = useState<{
    n: number
    conflicts: Conflict[]
    replace: boolean
    resolve: (a: Answers | null) => void
  } | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const files = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const pickFor = useRef<{ parentId: string | null; resume?: boolean }>({
    parentId: null,
  })
  const vaultPicks = useRef<((inputs: UploadInput[]) => void) | null>(null)

  // Refresh once a burst of uploads settles, not once per file.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    engine.listen(() => {
      clearTimeout(t)
      t = setTimeout(() => router.refresh(), 600)
    })
    return () => clearTimeout(t)
  }, [engine, router])

  // One dialog at a time when two uploads clash at once.
  async function ask(conflicts: Conflict[], replace = false) {
    if (!conflicts.length) return new Map() as Answers
    const asked = askQueue.current.then(
      () =>
        new Promise<Answers | null>((resolve) =>
          setAsking({ n: ++asks, conflicts, replace, resolve })
        )
    )
    askQueue.current = asked.then(() => {})
    return asked
  }

  async function uploadToVault(jobs: VaultJob[]) {
    setCollapsed(false)
    for (const j of jobs) {
      const { file } = j
      engine.add(
        {
          kind: "upload",
          name: j.name,
          mime: file.type,
          parentId: j.parentId,
          size: file.size,
          status: "queued",
          vault: j.vaultId,
        },
        {
          file,
          // Hashed, so vault names don't sit in localStorage.
          fingerprint: `nimbus-vault|${j.vaultId}|${j.parentId ?? ""}|${file.size}|${file.lastModified}|${await sha256(j.name)}`,
          meta: {
            filename: j.sealedName,
            nameTag: j.nameTag,
            token: j.token,
            ...(j.replaces && { replaces: j.replaces }),
          },
          vault: { vk: j.vk, vaultId: j.vaultId },
          onDone: j.onDone,
        }
      )
    }
    engine.pump()
  }

  // `onDone` hears about each file that lands (moves out of a vault use it).
  async function upload(
    inputs: UploadInput[],
    parentId: string | null,
    onDone?: () => void
  ) {
    if (!inputs.length) return
    setCollapsed(false)
    const plan = await planUpload(
      parentId,
      inputs.map((i) =>
        i.file
          ? { path: i.path, size: i.file.size }
          : { path: i.path, size: 0, dir: true }
      )
    ).catch(() => ({ error: "Couldn't start the upload. Try again." }) as const)
    if (plan.error || !("token" in plan) || !plan.token)
      return engine.fail(
        inputs.length === 1 ? inputs[0].path : `${inputs.length} items`,
        plan.error ?? "Couldn't start the upload. Try again."
      )

    for (const r of plan.rejected)
      engine.fail(r.path.split("/").pop()!, r.reason)
    const refused = new Set(plan.rejected.map((r) => r.path))
    let list = inputs.filter((i) => !refused.has(i.path))

    const answers = await ask(plan.conflicts)
    if (!answers) return

    // Folders first: their Keep both renames paths that file answers no longer match.
    const versions = new Set<string>()
    for (const c of plan.conflicts) {
      const a = answers.get(c.path)
      const inside = (p: string) => p === c.path || p.startsWith(`${c.path}/`)
      if (c.kind === "folder") {
        if (a === "skip") list = list.filter((i) => !inside(i.path))
        if (a === "keep")
          list = list.map((i) =>
            inside(i.path)
              ? { ...i, path: c.freeName + i.path.slice(c.path.length) }
              : i
          )
      }
    }
    for (const c of plan.conflicts) {
      if (c.kind !== "file") continue
      const a = answers.get(c.path)
      if (a === "skip") list = list.filter((i) => i.path !== c.path)
      if (a === "version") versions.add(c.path)
    }

    const dirs = list.filter((i) => !i.file).map((i) => i.path)
    if (dirs.length)
      createFolders(parentId, dirs)
        .catch(() => ({ error: "Couldn't create the empty folders." }))
        .then((r) => {
          if (r.error) engine.fail(`${dirs.length} empty folders`, r.error)
          else engine.onFinished()
        })

    for (const { file, path } of list) {
      if (!file) continue
      engine.add(
        {
          kind: "upload",
          name: file.name,
          mime: file.type,
          parentId,
          size: file.size,
          status: "queued",
        },
        {
          file,
          fingerprint: fingerprintOf(parentId, file, path),
          meta: {
            filename: path.split("/").pop()!,
            filetype: file.type,
            token: plan.token,
            path,
            onConflict: versions.has(path) ? "version" : "rename",
          },
          onDone,
        }
      )
    }
    engine.pump()
  }

  function pick(
    kind: "files" | "folder",
    parentId: string | null,
    resume = false
  ) {
    pickFor.current = { parentId, resume }
    ;(kind === "files" ? files : folder).current?.click()
  }

  function picked(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = [...(e.target.files ?? [])]
    e.target.value = ""
    const { parentId, resume } = pickFor.current
    if (!resume && vaultPicks.current)
      return vaultPicks.current(
        chosen.map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))
      )
    if (!resume)
      return upload(
        chosen.map((f) => ({ file: f, path: f.webkitRelativePath || f.name })),
        parentId
      )
    // Re-picked files go back where they were headed, under their old path, so
    // their fingerprints match and tus resumes them.
    const stale = engine.takeStale()
    const groups = new Map<string | null, UploadInput[]>()
    for (const f of chosen) {
      const s = stale.find(
        (s) =>
          s.size === f.size &&
          s.modified === f.lastModified &&
          s.path.split("/").pop() === f.name
      )
      const to = s ? s.parentId : parentId
      groups.set(to, [
        ...(groups.get(to) ?? []),
        { file: f, path: s?.path ?? f.name },
      ])
    }
    for (const [to, inputs] of groups) upload(inputs, to)
  }

  function download(items: Target[]) {
    if (!items.length) return
    if (items.length === 1 && items[0].kind === "file")
      return saveUrl(`/api/files/${items[0].id}/download`)
    if (zipMode === "server") {
      // Posted into a hidden frame: the attachment downloads, the page stays.
      let frame = document.querySelector<HTMLIFrameElement>(
        "iframe[name=nimbus-dl]"
      )
      if (!frame) {
        frame = document.createElement("iframe")
        frame.name = "nimbus-dl"
        frame.hidden = true
        document.body.append(frame)
      }
      const form = document.createElement("form")
      form.method = "POST"
      form.action = "/api/zip"
      form.target = "nimbus-dl"
      form.hidden = true
      for (const i of items) {
        const input = document.createElement("input")
        input.name = "ids"
        input.value = i.id
        form.append(input)
      }
      document.body.append(form)
      form.submit()
      form.remove()
      return
    }
    const name = zipName(items.length === 1 ? items[0].name : undefined)
    zipJob(name, (progress, signal) =>
      clientZipDownload(
        items.map((i) => i.id),
        name,
        progress,
        signal
      )
    )
  }

  // A zip built in this browser, shown in the panel while it saves.
  function zipJob(
    name: string,
    run: (
      progress: (sent: number, size: number) => void,
      signal: AbortSignal
    ) => Promise<boolean>
  ) {
    const abort = new AbortController()
    const id = engine.add(
      {
        kind: "zip",
        name,
        mime: "application/zip",
        parentId: null,
        size: 0,
        status: "uploading",
      },
      { abort }
    )
    setCollapsed(false)
    run((sent, size) => engine.progress(id, sent, size), abort.signal).then(
      (ok) => (ok ? engine.end(id) : engine.drop(id)),
      (e: Error) =>
        e.name !== "AbortError" && engine.end(id, "Couldn't make the zip.")
    )
  }

  function zipVault(
    name: string,
    load: (signal: AbortSignal) => Promise<ZipManifest>
  ) {
    zipJob(name, (progress, signal) =>
      zipDownload(load, name, progress, signal)
    )
  }

  function claimPicks(fn: (inputs: UploadInput[]) => void) {
    vaultPicks.current = fn
    return () => {
      if (vaultPicks.current === fn) vaultPicks.current = null
    }
  }

  const ctx: Ctx = {
    upload,
    download,
    uploadToVault,
    ask,
    claimPicks,
    zipVault,
    busy: () => engine.get().jobs.filter(running).length,
    leave: () => {
      leaving = true
    },
  }
  const here = parentFromPath(pathname)

  return (
    <UploadContext.Provider value={ctx}>
      <NewMenuContext.Provider value={{ pick: (k) => pick(k, here) }}>
        {children}
      </NewMenuContext.Provider>
      <input ref={files} type="file" multiple hidden onChange={picked} />
      <input
        ref={folder}
        type="file"
        hidden
        onChange={picked}
        // React has no typed prop for it.
        {...{ webkitdirectory: "" }}
      />
      <Panel
        engine={engine}
        collapsed={collapsed}
        onCollapse={setCollapsed}
        onResumeStale={() => pick("files", here, true)}
        onOpen={(j) =>
          router.push(
            j.vault
              ? `/vault/${j.vault}${j.parentId ? `?f=${j.parentId}` : ""}`
              : j.parentId
                ? `/folders/${j.parentId}`
                : "/"
          )
        }
      />
      {asking && (
        <ConflictDialog
          key={asking.n}
          conflicts={asking.conflicts}
          replace={asking.replace}
          onDone={(a) => {
            setAsking(null)
            asking.resolve(a)
          }}
        />
      )}
    </UploadContext.Provider>
  )
}

// Subscribes to the queue on its own so progress ticks re-render only the panel.
function Panel({
  engine,
  collapsed,
  onCollapse,
  onResumeStale,
  onOpen,
}: {
  engine: Engine
  collapsed: boolean
  onCollapse: (c: boolean) => void
  onResumeStale: () => void
  onOpen: (j: Job) => void
}) {
  const { jobs, stale } = useSyncExternalStore(
    engine.subscribe,
    engine.get,
    engine.getServer
  )

  // Files dropped outside a drop zone would otherwise open in the tab.
  useEffect(() => {
    function stop(e: DragEvent) {
      if (e.defaultPrevented || !e.dataTransfer?.types.includes("Files")) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "none"
    }
    window.addEventListener("dragover", stop)
    window.addEventListener("drop", stop)
    return () => {
      window.removeEventListener("dragover", stop)
      window.removeEventListener("drop", stop)
    }
  }, [])

  const active = jobs.some(running)
  useEffect(() => {
    if (!active) return
    const warn = (e: BeforeUnloadEvent) => !leaving && e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [active])

  // Stable, so the panel's auto-dismiss timer isn't restarted by re-renders.
  const close = useCallback(() => engine.clear(), [engine])
  const setNotice = useNotice()
  const router = useRouter()

  // "Same as …" → Remove: the new copy goes to the trash, with Undo.
  async function removeDuplicate(j: Job) {
    if (!j.nodeId) return
    const res = await trashItems([j.nodeId]).catch(() => ({
      error: "Couldn't move it to the trash. Try again.",
    }))
    if (res.error) return setNotice({ text: res.error, error: true })
    engine.drop(j.id)
    router.refresh()
    setNotice({
      text: `Moved “${j.name}” to the trash.`,
      undo: async () => {
        const back = await restoreItems([j.nodeId!]).catch(() => ({
          error: "Couldn't bring it back. Try again.",
        }))
        setNotice(
          back.error
            ? { text: back.error, error: true }
            : { text: `Restored “${j.name}”.` }
        )
        router.refresh()
      },
    })
  }

  if (!jobs.length && !stale.length) return null
  return (
    <UploadPanel
      jobs={jobs}
      stale={stale.length}
      collapsed={collapsed}
      onCollapse={onCollapse}
      onPause={(id) => (engine.pause(id), engine.pump())}
      onResume={(id) => (engine.resume(id), engine.pump())}
      onCancel={(id) => engine.cancel(id)}
      onPauseAll={() => (engine.pauseAll(), engine.pump())}
      onResumeAll={() => engine.resumeAll()}
      onClose={close}
      onResumeStale={onResumeStale}
      onDismissStale={() => engine.dismissStale()}
      onOpen={onOpen}
      onKeep={(id) => engine.keep(id)}
      onRemove={removeDuplicate}
    />
  )
}

const NewMenuContext = createContext<{ pick: (k: "files" | "folder") => void }>(
  {
    pick() {},
  }
)

// Sidebar "New": a primary button that shrinks to an icon with the rail.
// The folder page's New folder dialog, or My files' when this page has none.
export function startNewFolder(router: ReturnType<typeof useRouter>) {
  const btn = document.getElementById("new-folder")
  if (btn) return btn.click()
  wantsNewFolder = true
  router.push("/")
}

// File and folder upload pickers, into the folder being viewed.
export const usePick = () => useContext(NewMenuContext).pick

export function NewMenu() {
  const { pick } = useContext(NewMenuContext)
  const { collapsed } = useSidebar()
  const router = useRouter()
  const trigger = useRef<HTMLButtonElement>(null)

  // In the phone drawer, close it so the upload panel and dialogs are visible.
  // ponytail: fakes Escape for the Base UI drawer; give SidebarShell a close() if this breaks.
  function leaveDrawer() {
    if (trigger.current?.closest("[role=dialog]"))
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
  }

  function newFolder() {
    leaveDrawer()
    startNewFolder(router)
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            ref={trigger}
            aria-label="New"
            title={collapsed ? "New" : undefined}
            className="w-full justify-start group-data-[collapsed=true]/sidebar:size-8 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0"
          />
        }
      >
        <PlusIcon weight="bold" />
        <span className="group-data-[collapsed=true]/sidebar:sr-only">New</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={4}>
          <Menu.Popup className={cn("w-52", MENU_POPUP)}>
            <Menu.Item className={MENU_ITEM} onClick={newFolder}>
              <FolderSimplePlusIcon />
              New folder
              <kbd className="ml-auto font-sans text-xs text-muted-foreground">
                Shift N
              </kbd>
            </Menu.Item>
            <Menu.Separator className="-mx-1 my-1 h-px bg-border" />
            <Menu.Item
              className={MENU_ITEM}
              onClick={() => {
                leaveDrawer()
                pick("files")
              }}
            >
              <FileArrowUpIcon />
              File upload
            </Menu.Item>
            <Menu.Item
              className={MENU_ITEM}
              onClick={() => {
                leaveDrawer()
                pick("folder")
              }}
            >
              <UploadSimpleIcon />
              Folder upload
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
