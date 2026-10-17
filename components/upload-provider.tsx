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
import { Upload, type DetailedError } from "tus-js-client"

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
import { UploadPanel } from "@/components/upload-panel"
import { Button } from "@/components/ui/button"
import { clientZipDownload } from "@/lib/client-zip-download"
import { ensureThumb } from "@/lib/thumbs"
import { cn } from "@/lib/utils"

// A file, or an empty folder (file null), at a "/"-separated path relative to
// the target folder.
export type UploadInput = { file: File | null; path: string }
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
}

type Data = {
  file?: File
  meta?: Record<string, string>
  fingerprint?: string
  upload?: Upload
  // tus finished; only finishUpload is left (or needs a retry).
  uploaded?: boolean
  abort?: AbortController
}

const CONCURRENT = 3
const STORE = "tus::nimbus|"

// Fingerprint the resume flow can read back from localStorage:
// nimbus|<parent>|<size>|<lastModified>|<path>. Path is last since it may hold "|".
const fingerprintOf = (parentId: string | null, file: File, path: string) =>
  `nimbus|${parentId ?? ""}|${file.size}|${file.lastModified}|${path}`

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

function tusError(e: Error) {
  const body = (e as DetailedError).originalResponse?.getBody()?.trim()
  if (body && body.length < 200 && !body.includes("<")) return body
  return "Upload failed. Check your connection and retry."
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
    const up = new Upload(d.file!, {
      endpoint: this.tusUrl,
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
      storeFingerprintForResuming: true,
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
    up.findPreviousUploads().then((prev) => {
      if (prev[0]) up.resumeFromPreviousUpload(prev[0])
      if (this.job(id)?.status === "uploading") up.start()
    })
  }

  private async finish(id: string) {
    const d = this.data.get(id)!
    const file = d.file
    const res = await finishUpload(d.upload!.url!).catch(() => ({
      error: "Uploaded, but Nimbus couldn't save it. Retry.",
      nodeId: undefined,
    }))
    // A nodeId means it landed, even alongside an error (the tusd hook won).
    if (!res.nodeId) {
      this.patch(id, {
        status: "error",
        error: res.error ?? "Couldn't save it. Retry.",
      })
    } else {
      this.patch(id, { status: "done", sent: this.job(id)?.size ?? 0 })
      this.data.set(id, {})
      // Drawn from the local copy while it's at hand; failures just leave the icon.
      if (file && res.versionId)
        ensureThumb(
          {
            id: res.nodeId,
            version: res.versionId,
            mime: file.type || null,
            name: file.name,
            size: file.size,
          },
          file
        )
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
  drop(id: string) {
    this.data.delete(id)
    this.set({ jobs: this.state.jobs.filter((j) => j.id !== id) })
  }
}

type Ctx = {
  upload: (inputs: UploadInput[], parentId: string | null) => void
  download: (items: Target[]) => void
}
const UploadContext = createContext<Ctx>({ upload() {}, download() {} })
export const useUploads = () => useContext(UploadContext)

let asks = 0

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
  children,
}: {
  tusUrl: string
  zipMode: "server" | "client"
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [engine] = useState(() => new Engine(tusUrl))
  const askQueue = useRef(Promise.resolve())
  const [asking, setAsking] = useState<{
    n: number
    conflicts: Conflict[]
    resolve: (a: Answers | null) => void
  } | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const files = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const pickFor = useRef<{ parentId: string | null; resume?: boolean }>({
    parentId: null,
  })

  // Refresh once a burst of uploads settles, not once per file.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    engine.listen(() => {
      clearTimeout(t)
      t = setTimeout(() => router.refresh(), 600)
    })
    return () => clearTimeout(t)
  }, [engine, router])

  async function upload(inputs: UploadInput[], parentId: string | null) {
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

    // One dialog at a time when two uploads clash at once.
    let answers: Answers | null = new Map()
    if (plan.conflicts.length) {
      const ask = askQueue.current.then(
        () =>
          new Promise<Answers | null>((resolve) =>
            setAsking({ n: ++asks, conflicts: plan.conflicts, resolve })
          )
      )
      askQueue.current = ask.then(() => {})
      answers = await ask
    }
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
    const name =
      items.length === 1 ? `${items[0].name}.zip` : "Nimbus files.zip"
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
    clientZipDownload(
      items.map((i) => i.id),
      name,
      (sent, size) => engine.progress(id, sent, size),
      abort.signal
    ).then(
      (ok) => (ok ? engine.end(id) : engine.drop(id)),
      (e: Error) =>
        e.name !== "AbortError" && engine.end(id, "Couldn't make the zip.")
    )
  }

  const ctx: Ctx = { upload, download }
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
        onOpen={(j) => router.push(j.parentId ? `/folders/${j.parentId}` : "/")}
      />
      {asking && (
        <ConflictDialog
          key={asking.n}
          conflicts={asking.conflicts}
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

  const active = jobs.some(
    (j) => j.status === "uploading" || j.status === "queued"
  )
  useEffect(() => {
    if (!active) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [active])

  // Stable, so the panel's auto-dismiss timer isn't restarted by re-renders.
  const close = useCallback(() => engine.clear(), [engine])

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
    />
  )
}

const NewMenuContext = createContext<{ pick: (k: "files" | "folder") => void }>(
  {
    pick() {},
  }
)

// Sidebar "New": a primary button that shrinks to an icon with the rail.
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
    const btn = document.getElementById("new-folder")
    if (btn) return btn.click()
    wantsNewFolder = true
    router.push("/")
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
