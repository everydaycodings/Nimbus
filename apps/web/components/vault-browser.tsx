"use client"

import { ContextMenu } from "@base-ui/react/context-menu"
import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import {
  ArrowBendUpRightIcon,
  ArrowSquareOutIcon,
  ArrowCounterClockwiseIcon,
  CaretRightIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  EyeIcon,
  FileArrowUpIcon,
  FolderOpenIcon,
  FolderSimplePlusIcon,
  GridFourIcon,
  GridNineIcon,
  ListBulletsIcon,
  LockIcon,
  LockKeyIcon,
  MagnifyingGlassIcon,
  KeyIcon,
  PencilSimpleIcon,
  SquareIcon,
  SquaresFourIcon,
  TrashIcon,
  UploadSimpleIcon,
  type Icon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { deleteForever, trashItems } from "@/app/(app)/file-actions"
import { zipManifest, type Conflict } from "@/app/(app)/upload-actions"
import {
  createVaultFolders,
  deleteVault,
  deleteVaultNodes,
  moveVaultNodes,
  planVaultUpload,
  renameVaultNode,
  restoreVaultNodes,
  setVaultTags,
  trashVaultNodes,
  updateVaultKey,
  vaultFileUrl,
  vaultTree,
} from "@/app/(app)/vault/actions"
import { NameDialog, Segmented } from "@/components/file-browser"
import { useNotice } from "@/components/toaster"
import { MoveDialog as FilesPicker, type Place } from "@/components/move-dialog"
import { Previewer, type Decrypted } from "@/components/previewer"
import { LAYOUT_COOKIE, TILES_COOKIE } from "@/components/nav-styles"
import {
  DIALOG_BACKDROP,
  DIALOG_POPUP,
  MENU_ITEM,
  MENU_POPUP,
} from "@/components/overlay-styles"
import { usePasswordPolicy } from "@/components/password-input"
import { SubmitButton } from "@/components/submit-button"
import {
  pastedFiles,
  readDrop,
  usePick,
  useUploads,
  type Lazy,
  type UploadInput,
  type VaultJob,
} from "@/components/upload-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useVaultKeys } from "@/components/vault-keys"
import { PassphraseFields } from "@/components/vault-list"
import {
  pickSaveTarget,
  saveStream,
  type ZipManifest,
} from "@/lib/client-zip-download"
import { extOf, freeName, mimeOf, previewKind } from "@/lib/file-rules"
import { fileType, formatBytes } from "@/lib/file-types"
import type { Item } from "@/lib/files"
import { passwordProblem } from "@/lib/password-policy"
import { readRange } from "@/lib/thumbs"
import { cn } from "@/lib/utils"
import {
  decName,
  decryptStream,
  encName,
  nameTag,
  openFileKey,
  plainSize,
  plainSlice,
  rewrap,
  unlockWithPassphrase,
  unlockWithRecovery,
} from "@/lib/vault-crypto"

export type VaultInfo = {
  id: string
  name: string
  salt: string
  wrapped: string
  recoveryWrapped: string
  kdf: { t: number; m: number }
}

type Props = {
  vault: VaultInfo
  blocked: string[]
  layout: "grid" | "list"
  compact: boolean
  tiles: "small" | "medium" | "large"
}

type Rekey = Pick<VaultInfo, "salt" | "wrapped" | "kdf">

export function VaultView(props: Props) {
  const vk = useVaultKeys().keys.get(props.vault.id)
  // Opened with the recovery key, so a new passphrase is offered.
  const [rescued, setRescued] = useState(false)
  // A passphrase changed here, so unlocking doesn't wait for fresh props.
  const [rekey, setRekey] = useState<Rekey | null>(null)
  const vault = { ...props.vault, ...rekey }
  return vk ? (
    <VaultBrowser
      {...props}
      vault={vault}
      vk={vk}
      rescued={rescued}
      onRekey={setRekey}
    />
  ) : (
    <Unlock vault={vault} onUnlocked={setRescued} />
  )
}

function Unlock({
  vault,
  onUnlocked,
}: {
  vault: VaultInfo
  // True when it was the recovery key.
  onUnlocked: (recovery: boolean) => void
}) {
  const { unlock } = useVaultKeys()
  const [recovery, setRecovery] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(secret: string) {
    setPending(true)
    setError(null)
    try {
      const vk = recovery
        ? await unlockWithRecovery(vault.recoveryWrapped, secret)
        : await unlockWithPassphrase(vault, secret)
      onUnlocked(recovery)
      unlock(vault.id, vk)
    } catch {
      setError(
        recovery
          ? "That recovery key doesn't open this vault."
          : "That passphrase doesn't open this vault."
      )
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100svh-10rem)] flex-col items-center justify-center">
      <form
        className="flex w-full max-w-sm flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit(String(new FormData(e.currentTarget).get("secret")))
        }}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-muted">
            <LockIcon className="size-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight break-words">
            {vault.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {recovery
              ? "Enter the recovery key you saved when you made this vault."
              : "This vault is locked. Its files are decrypted in this browser only."}
          </p>
        </div>
        <div className="grid gap-2">
          <Input
            key={String(recovery)}
            name="secret"
            type={recovery ? "text" : "password"}
            aria-label={recovery ? "Recovery key" : "Passphrase"}
            placeholder={recovery ? "XXXX-XXXX-…" : "Passphrase"}
            autoComplete={recovery ? "off" : "current-password"}
            spellCheck={false}
            autoFocus
            aria-invalid={Boolean(error)}
            className={cn(recovery && "font-mono")}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <SubmitButton pending={pending}>Unlock</SubmitButton>
        <button
          type="button"
          onClick={() => {
            setRecovery(!recovery)
            setError(null)
          }}
          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {recovery
            ? "Use the passphrase instead"
            : "Forgot it? Use the recovery key"}
        </button>
      </form>
    </div>
  )
}

type Entry = {
  id: string
  parentId: string | null
  kind: "file" | "folder"
  name: string
  mime: string | null
  size: number
  updatedAt: string
  trashedAt: string | null
}

// Previews decrypt the whole file into memory first; bigger files download.
const VIEW_MAX = 1024 ** 3
const viewable = (n: Entry) =>
  n.kind === "file" &&
  n.size <= VIEW_MAX &&
  previewKind(n.mime, n.name) !== null

// What the previewer needs to show a vault file.
const asItem = (n: Entry): Item => ({
  id: n.id,
  kind: "file",
  name: n.name,
  size: n.size,
  mime: n.mime,
  starred: false,
  updatedAt: n.updatedAt,
  trashedAt: null,
  tags: [],
  version: null,
  thumb: "",
  sharedWithPeople: false,
  hasLink: false,
})

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const lower = (s: string) => s.toLowerCase()

function savePref(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`
}

// Shortcuts stay out of the way while someone types or works in a menu or dialog.
const busyTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  Boolean(
    t.closest(
      "input, textarea, select, [contenteditable], [role=dialog], [role=menu]"
    )
  )

function when(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  })
}

// The server checked names before; in a vault it can't, so the browser does.
function nameError(raw: string, siblings: Entry[], self?: Entry) {
  const name = raw.trim()
  if (!name) return "Enter a name."
  if (name.length > 255) return "Keep names under 255 characters."
  if (name === "." || name === ".." || /[/\\\0]/.test(name))
    return "Names can't be . or .. or contain / or \\."
  if (siblings.some((s) => s !== self && lower(s.name) === lower(name)))
    return "Something with that name is already in this folder."
  return null
}

type Act = {
  label: string
  icon: Icon
  kbd?: string
  danger?: boolean
  run: () => void
}

function VaultBrowser({
  vault,
  vk,
  blocked,
  layout: initialLayout,
  compact,
  tiles: initialTiles,
  rescued,
  onRekey,
}: Props & {
  vk: CryptoKey
  rescued: boolean
  onRekey: (k: Rekey) => void
}) {
  const router = useRouter()
  const params = useSearchParams()
  const folderParam = params.get("f")
  const inTrash = params.has("trash")
  const { lock } = useVaultKeys()
  const {
    upload: uploadToFiles,
    uploadToVault,
    ask,
    claimPicks,
    zipVault,
  } = useUploads()
  const importIds = params.get("import")
  const pick = usePick()
  const [nodes, setNodes] = useState<Entry[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [layout, setLayout] = useState(initialLayout)
  const [tiles, setTiles] = useState(initialTiles)
  const [filter, setFilter] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const setNotice = useNotice()
  const [naming, setNaming] = useState<{ item: Entry | null } | null>(null)
  const [nameErr, setNameErr] = useState<string | null>(null)
  const [moving, setMoving] = useState<Entry[] | null>(null)
  const [movingOut, setMovingOut] = useState<Entry[] | null>(null)
  const [deleting, setDeleting] = useState<Entry[] | null>(null)
  const [pending, setPending] = useState(false)
  const [osDrag, setOsDrag] = useState(false)
  const [dropId, setDropId] = useState<string | null>(null)
  const [viewing, setViewing] = useState<Entry | null>(null)
  const [src, setSrc] = useState<Decrypted>(null)
  const [vaultDialog, setVaultDialog] = useState<"pass" | "delete" | null>(
    rescued ? "pass" : null
  )

  // The tree with names decrypted, or null when the server refused.
  const fetchTree = useCallback(async (): Promise<Entry[] | null> => {
    const rows = await vaultTree(vault.id).catch(() => null)
    if (!rows) return null
    const untagged: { id: string; tag: string }[] = []
    const tree = await Promise.all(
      rows.map(async (r) => {
        const n = await decName(vk, r.name).catch(() => null)
        if (n && !r.tagged)
          untagged.push({ id: r.id, tag: await nameTag(vk, n.n) })
        return {
          id: r.id,
          parentId: r.parentId,
          kind: r.kind,
          name: n?.n ?? "Unreadable item",
          mime: n?.t ?? null,
          size: r.kind === "file" ? plainSize(r.size) : 0,
          updatedAt: r.updatedAt,
          trashedAt: r.trashedAt,
        }
      })
    )
    // Items from before name tags get theirs now.
    if (untagged.length) setVaultTags(vault.id, untagged).catch(() => {})
    return tree
  }, [vault.id, vk])

  // A file's bytes, decrypted as the ciphertext streams in.
  const plaintext = useCallback(
    async (id: string, signal?: AbortSignal) => {
      const f = await vaultFileUrl(vault.id, id)
      if (!f) throw new Error("gone")
      const fk = await openFileKey(vk, f.encKey)
      const res = await fetch(f.url, { signal })
      if (!res.ok || !res.body) throw new Error(String(res.status))
      return res.body.pipeThrough(decryptStream(fk))
    },
    [vault.id, vk]
  )

  // The previewed file, decrypted into memory; freed when it changes.
  useEffect(() => {
    if (!viewing) return
    const abort = new AbortController()
    let url: string | null = null
    plaintext(viewing.id, abort.signal)
      .then((body) => new Response(body).blob())
      .then((bytes) => {
        if (abort.signal.aborted) return
        const blob = new Blob([bytes], { type: viewing.mime ?? "" })
        url = URL.createObjectURL(blob)
        setSrc({ blob, url })
      })
      .catch(() => {
        if (abort.signal.aborted) return
        setViewing(null)
        setNotice({ text: `Couldn't open “${viewing.name}”.`, error: true })
      })
    return () => {
      abort.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [viewing, plaintext, setNotice])

  const load = useCallback(
    () =>
      fetchTree().then((tree) => {
        setLoadError(!tree)
        if (tree) setNodes(tree)
      }),
    [fetchTree]
  )
  useEffect(() => {
    let live = true
    fetchTree().then((tree) => {
      if (!live) return
      setLoadError(!tree)
      if (tree) setNodes(tree)
    })
    return () => {
      live = false
    }
  }, [fetchTree])

  // Finished uploads come in bursts; reload once they settle.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const changed = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(load, 500)
  }, [load])
  useEffect(() => () => clearTimeout(timer.current), [])

  const all = useMemo(() => nodes ?? [], [nodes])
  const allById = useMemo(() => new Map(all.map((n) => [n.id, n])), [all])
  const live = useMemo(() => all.filter((n) => !n.trashedAt), [all])
  // What went into the trash together shares a timestamp; list the tops.
  const trashed = useMemo(
    () =>
      all.filter(
        (n) =>
          n.trashedAt &&
          allById.get(n.parentId ?? "")?.trashedAt !== n.trashedAt
      ),
    [all, allById]
  )
  const byId = useMemo(() => new Map(live.map((n) => [n.id, n])), [live])
  const byParent = useMemo(() => {
    const m = new Map<string, Entry[]>()
    for (const n of live) {
      const k = n.parentId ?? ""
      m.set(k, [...(m.get(k) ?? []), n])
    }
    return m
  }, [live])
  const kidsOf = useCallback(
    (id: string | null) => byParent.get(id ?? "") ?? [],
    [byParent]
  )
  // A folder's size is everything inside it that shares its trash state.
  const sizes = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of all) {
      if (n.kind !== "file") continue
      for (
        let p = allById.get(n.parentId ?? "");
        p && p.trashedAt === n.trashedAt;
        p = allById.get(p.parentId ?? "")
      )
        m.set(p.id, (m.get(p.id) ?? 0) + n.size)
    }
    return m
  }, [all, allById])

  const folder =
    folderParam && byId.get(folderParam)?.kind === "folder" ? folderParam : null
  const path = useMemo(() => {
    const out: Entry[] = []
    for (let p = folder; p; p = byId.get(p)?.parentId ?? null) {
      const n = byId.get(p)
      if (!n) break
      out.unshift(n)
    }
    return out
  }, [folder, byId])
  const where = (n: Entry) => {
    const names: string[] = []
    for (let p = n.parentId; p; p = allById.get(p)?.parentId ?? null)
      names.unshift(allById.get(p)?.name ?? "")
    return names.length ? names.join(" / ") : vault.name
  }

  const q = lower(filter.trim())
  const showWhere = Boolean(q) || inTrash
  const items = useMemo(() => {
    const list = inTrash
      ? trashed.filter((n) => lower(n.name).includes(q))
      : q
        ? live.filter((n) => lower(n.name).includes(q))
        : kidsOf(folder)
    return [...list].sort(
      (a, b) =>
        Number(b.kind === "folder") - Number(a.kind === "folder") ||
        a.name.localeCompare(b.name, undefined, { numeric: true })
    )
  }, [q, inTrash, trashed, live, kidsOf, folder])
  const folders = items.filter((i) => i.kind === "folder")
  const files = items.filter((i) => i.kind === "file")
  const sel = items.filter((i) => selected.has(i.id))

  function go(id: string | null) {
    setSelected(new Set())
    setFilter("")
    router.push(id ? `/vault/${vault.id}?f=${id}` : `/vault/${vault.id}`)
  }
  function selectOnly(id: string) {
    setSelected(new Set([id]))
    setAnchor(id)
  }
  function toggle(id: string) {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    setSelected(next)
    setAnchor(id)
  }
  function selectRange(id: string) {
    const a = items.findIndex((i) => i.id === anchor)
    const b = items.findIndex((i) => i.id === id)
    if (a < 0) return selectOnly(id)
    const [from, to] = a < b ? [a, b] : [b, a]
    setSelected(new Set(items.slice(from, to + 1).map((i) => i.id)))
  }
  function onClick(e: React.MouseEvent, n: Entry) {
    if (e.shiftKey) selectRange(n.id)
    else if (e.metaKey || e.ctrlKey) toggle(n.id)
    else selectOnly(n.id)
  }

  function open(n: Entry) {
    if (inTrash) return
    if (n.kind === "folder") go(n.id)
    else if (viewable(n)) show(n)
    else download(n)
  }

  function show(n: Entry) {
    setViewing(n)
    setSrc(null)
  }
  function closeView() {
    setViewing(null)
    setSrc(null)
  }

  function zip(t: Entry[]) {
    const name = `${t.length === 1 ? t[0].name : vault.name}.zip`
    zipVault(name, async (signal) => {
      const dirs: string[] = []
      const entries: ZipManifest["entries"] = []
      const walk = (n: Entry, path: string) => {
        if (n.kind === "folder") {
          dirs.push(path)
          for (const k of kidsOf(n.id)) walk(k, `${path}/${k.name}`)
        } else
          entries.push({
            path,
            size: n.size,
            modified: n.updatedAt,
            open: () => plaintext(n.id, signal),
          })
      }
      for (const n of t) walk(n, n.name)
      return { name, dirs, entries }
    })
  }

  const what = (t: Entry[]) =>
    t.length === 1 ? `“${t[0].name}”` : plural(t.length, "item")

  async function download(n: Entry) {
    // The save picker needs the click, so it opens before anything else.
    const target = await pickSaveTarget(n.name)
    if (target === false) return
    setNotice({ text: `Decrypting “${n.name}”…` })
    try {
      await saveStream(
        await plaintext(n.id),
        target,
        n.name,
        new AbortController().signal
      )
      setNotice({ text: `Saved “${n.name}”.` })
    } catch {
      setNotice({ text: `Couldn't download “${n.name}”.`, error: true })
    }
  }

  async function submitName(value: string) {
    const item = naming?.item ?? null
    const siblings = kidsOf(item ? item.parentId : folder)
    const err = nameError(value, siblings, item ?? undefined)
    if (err) return setNameErr(err)
    setPending(true)
    const sealed = await encName(vk, {
      n: value.trim(),
      t: item?.mime ?? null,
    })
    const tag = await nameTag(vk, value.trim())
    const res = item
      ? await renameVaultNode(vault.id, item.id, sealed, tag)
      : await createVaultFolders(vault.id, [
          { key: "new", parent: folder, name: sealed, tag },
        ])
    setPending(false)
    if (res.error) return setNameErr(res.error)
    setNaming(null)
    setNotice({
      text: item
        ? `Renamed to “${value.trim()}”.`
        : `Created folder “${value.trim()}”.`,
    })
    load()
  }

  async function moveTo(target: string | null) {
    if (!moving) return
    const clash = moving.find((m) =>
      kidsOf(target).some((k) => k !== m && lower(k.name) === lower(m.name))
    )
    if (clash)
      return setNotice({
        text: `Something named “${clash.name}” is already in that folder.`,
        error: true,
      })
    setPending(true)
    const res = await moveVaultNodes(
      vault.id,
      moving.map((m) => m.id),
      target
    )
    setPending(false)
    setMoving(null)
    if (res.error) setNotice({ text: res.error, error: true })
    else {
      setSelected(new Set())
      setNotice({
        text: `Moved ${what(moving)} to ${target ? `“${byId.get(target)?.name}”` : "the vault's top level"}.`,
      })
    }
    load()
  }

  async function trash(t: Entry[]) {
    const res = await trashVaultNodes(
      vault.id,
      t.map((n) => n.id)
    )
    setSelected(new Set())
    setNotice(
      res.error
        ? { text: res.error, error: true }
        : {
            text: `Moved ${what(t)} to this vault's trash.`,
          }
    )
    load()
  }

  // Back to its folder, or the root if that folder is in the trash too. Names
  // are checked here, since the server can't read them.
  async function restore(t: Entry[]) {
    const clash: Entry[] = []
    const ok: Entry[] = []
    for (const n of t) {
      const dest = n.parentId && byId.has(n.parentId) ? n.parentId : null
      const taken = kidsOf(dest).some((k) => lower(k.name) === lower(n.name))
      ;(taken ? clash : ok).push(n)
    }
    const res = await restoreVaultNodes(
      vault.id,
      ok.map((n) => n.id)
    )
    setSelected(new Set())
    if (res.error) setNotice({ text: res.error, error: true })
    else if (clash.length || res.kept)
      setNotice({
        text: `${clash.length ? clash.map((n) => `“${n.name}”`).join(", ") : plural(res.kept!, "item")} couldn't come back because something with the same name is in its folder now. Rename that one, then restore again.`,
        error: true,
      })
    else setNotice({ text: `Restored ${what(t)}.` })
    load()
  }

  async function confirmDelete() {
    if (!deleting) return
    setPending(true)
    const res = await deleteVaultNodes(
      vault.id,
      deleting.map((d) => d.id)
    )
    setPending(false)
    setDeleting(null)
    setSelected(new Set())
    setNotice(
      res.error
        ? { text: res.error, error: true }
        : { text: `Deleted ${what(deleting)} forever.` }
    )
    load()
  }

  // Names are checked here (the server only sees ciphertext), folders are made
  // first, then each file is queued with a token for its folder. True when
  // every file was queued; `onFile` hears about each one that lands.
  async function upload(
    inputs: UploadInput[],
    target: string | null,
    onFile?: () => void
  ): Promise<boolean> {
    if (!inputs.length || !nodes) return false
    let list = inputs.filter(
      (i) => !i.file || !blocked.includes(extOf(i.path.split("/").pop()!))
    )
    if (list.length < inputs.length)
      setNotice({
        text: `${plural(inputs.length - list.length, "file")} skipped: that type can't be uploaded here.`,
        error: true,
      })
    const named = (pid: string | null, name: string) =>
      kidsOf(pid).find((k) => lower(k.name) === lower(name))
    const taken = (pid: string | null) =>
      new Set(kidsOf(pid).map((k) => lower(k.name)))
    const renameTop = (from: string, to: string) =>
      (list = list.map((i) =>
        i.path === from || i.path.startsWith(`${from}/`)
          ? { ...i, path: to + i.path.slice(from.length) }
          : i
      ))

    const conflicts: Conflict[] = []
    const existing = new Map<string, string>()
    const tops = new Map<string, "file" | "folder">()
    for (const i of list) {
      const [first, ...rest] = i.path.split("/")
      tops.set(first, rest.length || !i.file ? "folder" : "file")
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
    for (const i of list) {
      if (!i.file || !i.path.includes("/")) continue
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
        conflicts.push({
          path: i.path,
          kind: "file",
          freeName: freeName(file, taken(pid)),
        })
        existing.set(i.path, ex.id)
      }
    }

    const answers = await ask(conflicts, true)
    if (!answers) return false
    const replaces = new Map<string, string>()
    for (const c of conflicts) {
      const a = answers.get(c.path)
      if (c.kind === "folder") {
        if (a === "skip")
          list = list.filter(
            (i) => i.path !== c.path && !i.path.startsWith(`${c.path}/`)
          )
        if (a === "keep") renameTop(c.path, c.freeName)
      }
    }
    for (const c of conflicts) {
      if (c.kind !== "file") continue
      const a = answers.get(c.path)
      if (a === "skip") list = list.filter((i) => i.path !== c.path)
      if (a === "version") replaces.set(c.path, existing.get(c.path)!)
      if (a === "keep") {
        const dir = c.path.slice(0, c.path.lastIndexOf("/") + 1)
        list = list.map((i) =>
          i.path === c.path ? { ...i, path: dir + c.freeName } : i
        )
        // Keep both on a top-level file renames it, so it isn't replacing.
      }
    }

    // Every folder the upload needs, parents first, made where missing.
    const dirs = new Set<string>()
    for (const i of list) {
      const parts = i.path.split("/")
      for (let k = 1; k <= parts.length - (i.file ? 1 : 0); k++)
        dirs.add(parts.slice(0, k).join("/"))
    }
    const ids = new Map<string, string | null>([["", target]])
    const make: {
      key: string
      parent: string | null
      name: string
      tag: string
    }[] = []
    for (const d of [...dirs].sort(
      (a, b) => a.split("/").length - b.split("/").length
    )) {
      const cut = d.lastIndexOf("/")
      const parentPath = cut < 0 ? "" : d.slice(0, cut)
      const name = d.slice(cut + 1)
      const pid = ids.get(parentPath)
      const ex = pid !== undefined ? named(pid, name) : undefined
      if (ex?.kind === "folder") ids.set(d, ex.id)
      else
        make.push({
          key: d,
          parent: pid !== undefined ? pid : parentPath,
          name: await encName(vk, { n: name, t: null }),
          tag: await nameTag(vk, name),
        })
    }
    if (make.length) {
      const res = await createVaultFolders(vault.id, make)
      if (!res.ids) {
        setNotice({
          text: res.error ?? "Couldn't make the folders.",
          error: true,
        })
        return false
      }
      for (const [k, id] of Object.entries(res.ids)) ids.set(k, id)
      changed()
    }

    const queued = list.filter((i): i is UploadInput & { file: File | Lazy } =>
      Boolean(i.file)
    )
    const whole = queued.length === inputs.filter((i) => i.file).length
    if (!queued.length) return whole
    const parentOf = (p: string) =>
      ids.get(p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "") ?? null
    const groups = new Map<string | null, typeof queued>()
    for (const i of queued) {
      const pid = parentOf(i.path)
      groups.set(pid, [...(groups.get(pid) ?? []), i])
    }
    const plan = await planVaultUpload(
      vault.id,
      [...groups].map(([parentId, g]) => ({
        parentId,
        sizes: g.map((i) => i.file.size),
      }))
    ).catch(() => ({ error: "Couldn't start the upload. Try again." }))
    if (!("tokens" in plan) || !plan.tokens) {
      setNotice({
        text: plan.error ?? "Couldn't start the upload.",
        error: true,
      })
      return false
    }
    const jobs: VaultJob[] = []
    let g = 0
    for (const [parentId, group] of groups) {
      const token = plan.tokens[g++]
      for (const i of group) {
        const name = i.path.split("/").pop()!
        jobs.push({
          file: i.file,
          name,
          vaultId: vault.id,
          parentId,
          token,
          sealedName: await encName(vk, { n: name, t: i.file.type || null }),
          nameTag: await nameTag(vk, name),
          vk,
          replaces: replaces.get(i.path),
          onDone: () => {
            changed()
            onFile?.()
          },
        })
      }
    }
    uploadToVault(jobs)
    return whole
  }

  // From My files: each file streams in by byte range and is uploaded here like
  // any other. The originals are deleted for good once every one has landed.
  async function moveIn(ids: string[]) {
    setNotice({ text: "Getting the files ready to encrypt…" })
    let inputs: UploadInput[]
    try {
      const m = await zipManifest(ids)
      inputs = [
        ...m.dirs.map((path) => ({ path, file: null })),
        ...m.entries.map((e) => {
          const name = e.path.split("/").pop()!
          const file: Lazy = {
            name,
            type: mimeOf(null, name),
            size: e.size,
            lastModified: Date.parse(e.modified),
            read: (s, end) => readRange(e.url, s, end),
          }
          return { path: e.path, file }
        }),
      ]
    } catch {
      return setNotice({
        text: "Couldn't read those files. Nothing was moved.",
        error: true,
      })
    }
    setNotice(null)
    let left = inputs.filter((i) => i.file).length
    const finish = async () => {
      await trashItems(ids)
      await deleteForever(ids)
      setNotice({
        text: `Moved ${plural(ids.length, "item")} into this vault. The originals are deleted.`,
      })
    }
    const whole = await upload(inputs, folder, () => {
      if (--left === 0 && whole) finish()
    })
    if (!whole)
      setNotice({
        text: "Some items stayed out of the vault, so the originals in My files are kept.",
      })
    else if (!left) finish()
  }

  // Back to My files: each file is decrypted range by range as it uploads, as
  // an ordinary file. The vault copies go only once every file has landed.
  async function moveOut(t: Entry[], to: Place) {
    setSelected(new Set())
    setNotice({ text: `Getting ${plural(t.length, "item")} ready…` })
    const inputs: UploadInput[] = []
    try {
      const walk = async (n: Entry, path: string) => {
        if (n.kind === "folder") {
          inputs.push({ path, file: null })
          for (const k of kidsOf(n.id)) await walk(k, `${path}/${k.name}`)
          return
        }
        const f = await vaultFileUrl(vault.id, n.id)
        if (!f) throw new Error("gone")
        const fk = await openFileKey(vk, f.encKey)
        const file: Lazy = {
          name: n.name,
          type: n.mime ?? mimeOf(null, n.name),
          size: n.size,
          lastModified: Date.parse(n.updatedAt),
          read: (s, e) =>
            plainSlice(fk, f.size, (a, b) => readRange(f.url, a, b), s, e),
        }
        inputs.push({ path, file })
      }
      for (const n of t) await walk(n, n.name)
    } catch {
      return setNotice({
        text: "Couldn't open those files. Nothing was moved.",
        error: true,
      })
    }
    setNotice(null)
    let left = inputs.filter((i) => i.file).length
    const finish = async () => {
      await deleteVaultNodes(
        vault.id,
        t.map((n) => n.id)
      )
      setNotice({
        text: `Moved ${plural(t.length, "item")} to ${to.name}. They're no longer encrypted.`,
      })
      load()
    }
    uploadToFiles(inputs, to.id, () => {
      if (--left === 0) finish()
    })
    if (!left) finish()
  }

  // "Move to vault…" in My files lands here with the item ids.
  const imported = useRef<string | null>(null)
  useEffect(() => {
    if (!importIds || !nodes || imported.current === importIds) return
    imported.current = importIds
    router.replace(`/vault/${vault.id}`)
    moveIn(importIds.split(","))
  })

  // The sidebar's upload pickers and pastes go into this folder. Re-bound
  // each render, so they always see the current folder and tree.
  useEffect(() => claimPicks((inputs) => upload(inputs, folder)))
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (busyTarget(e.target)) return
      const files = pastedFiles(e)
      if (!files.length) return
      e.preventDefault()
      upload(files, folder)
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  })

  function actions(t: Entry[]): Act[] {
    if (!t.length) return []
    if (inTrash)
      return [
        {
          label: "Restore",
          icon: ArrowCounterClockwiseIcon,
          run: () => restore(t),
        },
        {
          label: "Delete forever",
          icon: TrashIcon,
          kbd: "Del",
          danger: true,
          run: () => setDeleting(t),
        },
      ]
    const one = t.length === 1 ? t[0] : null
    const acts: Act[] = []
    if (one?.kind === "folder")
      acts.push({
        label: "Open",
        icon: FolderOpenIcon,
        kbd: "Enter",
        run: () => go(one.id),
      })
    if (one && viewable(one))
      acts.push({
        label: "Open",
        icon: EyeIcon,
        kbd: "Enter",
        run: () => show(one),
      })
    acts.push({
      label: "Download",
      icon: DownloadSimpleIcon,
      kbd: one?.kind === "file" && !viewable(one) ? "Enter" : undefined,
      run: () => (one?.kind === "file" ? download(one) : zip(t)),
    })
    if (one)
      acts.push({
        label: "Rename",
        icon: PencilSimpleIcon,
        kbd: "F2",
        run: () => {
          setNameErr(null)
          setNaming({ item: one })
        },
      })
    acts.push(
      { label: "Move…", icon: ArrowBendUpRightIcon, run: () => setMoving(t) },
      {
        label: "Move to My files…",
        icon: ArrowSquareOutIcon,
        run: () => setMovingOut(t),
      },
      {
        label: "Move to trash",
        icon: TrashIcon,
        kbd: "Del",
        danger: true,
        run: () => trash(t),
      }
    )
    return acts
  }

  function newFolder() {
    setNameErr(null)
    setNaming({ item: null })
  }

  const busy = Boolean(
    naming || moving || movingOut || deleting || vaultDialog || viewing
  )
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (busy || busyTarget(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault()
        setSelected(new Set(items.map((i) => i.id)))
      } else if (e.key === "Escape") setSelected(new Set())
      else if ((e.key === "Delete" || e.key === "Backspace") && sel.length) {
        if (inTrash) setDeleting(sel)
        else trash(sel)
      } else if (inTrash) return
      else if (e.key === "N" && e.shiftKey) newFolder()
      else if (e.key === "Enter" && sel.length === 1) open(sel[0])
      else if (e.key === "F2" && sel.length === 1) {
        e.preventDefault()
        setNameErr(null)
        setNaming({ item: sel[0] })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const osFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files")
  // Folder tiles and breadcrumbs take files dropped from the OS.
  function dropTarget(id: string | null) {
    const key = id ?? "root"
    return {
      "data-drop": dropId === key || undefined,
      onDragOver(e: React.DragEvent) {
        if (!osFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setDropId(key)
        setOsDrag(false)
      },
      onDragLeave() {
        setDropId((d) => (d === key ? null : d))
      },
      onDrop(e: React.DragEvent) {
        if (!osFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setDropId(null)
        readDrop(e.dataTransfer).then((f) => upload(f, id))
      },
    }
  }

  function menu(t: Entry[], Item: typeof Menu.Item) {
    const acts = actions(t)
    if (!acts.length && inTrash) return null
    if (!acts.length)
      return (
        <Item className={MENU_ITEM} onClick={newFolder}>
          <FolderSimplePlusIcon />
          New folder
          <Kbd>Shift N</Kbd>
        </Item>
      )
    return acts.map((a, i) => (
      <Fragment key={a.label}>
        {a.danger && i > 0 && (
          <Menu.Separator className="-mx-1 my-1 h-px bg-border" />
        )}
        <Item
          className={cn(
            MENU_ITEM,
            a.danger && "text-destructive [&_svg]:text-destructive"
          )}
          onClick={a.run}
        >
          <a.icon />
          {a.label}
          {a.kbd && <Kbd>{a.kbd}</Kbd>}
        </Item>
      </Fragment>
    ))
  }

  function itemMenu(n: Entry) {
    return (
      <Menu.Root>
        <Menu.Trigger
          aria-label={`Actions for ${n.name}`}
          onClick={(e) => {
            e.stopPropagation()
            if (!selected.has(n.id)) selectOnly(n.id)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity outline-none group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-popup-open:opacity-100 max-sm:opacity-100"
        >
          <DotsThreeIcon weight="bold" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4}>
            <Menu.Popup className={`w-52 ${MENU_POPUP}`}>
              {menu(sel.length && selected.has(n.id) ? sel : [n], Menu.Item)}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    )
  }

  const itemProps = (n: Entry) => ({
    "data-id": n.id,
    role: "option",
    tabIndex: 0,
    "aria-selected": selected.has(n.id),
    onClick: (e: React.MouseEvent) => onClick(e, n),
    onDoubleClick: () => open(n),
    ...(n.kind === "folder" && !inTrash ? dropTarget(n.id) : {}),
  })

  const lead = (n: Entry, size: string) => {
    const t = fileType(n.kind, n.mime, n.name)
    return (
      <t.icon
        weight={n.kind === "folder" ? "fill" : "regular"}
        className={cn("shrink-0", size, t.color)}
      />
    )
  }
  const label = (n: Entry) => (
    <span className="truncate text-sm font-medium" title={n.name}>
      {n.name}
    </span>
  )
  const meta = (n: Entry) => (
    <span className="truncate text-xs text-muted-foreground tabular-nums">
      {showWhere
        ? where(n)
        : `${formatBytes(n.kind === "folder" ? (sizes.get(n.id) ?? 0) : n.size)} · ${when(n.updatedAt)}`}
    </span>
  )

  const TILE =
    "group relative rounded-xl border outline-none transition-colors select-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-selected:border-brand/60 aria-selected:bg-brand/8 data-drop:border-brand data-drop:bg-brand/15"
  const COLS =
    "grid-cols-[minmax(0,1fr)_2rem] sm:grid-cols-[minmax(0,1fr)_9rem_6rem_2rem]"

  const grid = (
    <>
      {folders.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Folders</h2>
          <div className="grid grid-cols-2 gap-gap-ui sm:grid-cols-[repeat(auto-fill,minmax(var(--tile),1fr))]">
            {folders.map((f) => (
              <div
                key={f.id}
                {...itemProps(f)}
                className={cn(TILE, "flex items-center gap-3 py-2 pr-1 pl-3")}
              >
                {lead(f, "size-5")}
                <span className="flex min-w-0 flex-1 flex-col">
                  {label(f)}
                  {meta(f)}
                </span>
                {itemMenu(f)}
              </div>
            ))}
          </div>
        </section>
      )}
      {files.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Files</h2>
          <div className="grid grid-cols-2 gap-gap-ui sm:grid-cols-[repeat(auto-fill,minmax(var(--tile),1fr))]">
            {files.map((f) => {
              const t = fileType(f.kind, f.mime, f.name)
              return (
                <div
                  key={f.id}
                  {...itemProps(f)}
                  className={cn(TILE, "flex flex-col")}
                >
                  <div className="flex h-file-row items-center gap-2 pr-1 pl-3">
                    {lead(f, "size-4")}
                    <span className="flex min-w-0 flex-1">{label(f)}</span>
                    {itemMenu(f)}
                  </div>
                  <div className="mx-1.5 mb-1.5 grid aspect-[4/3] place-items-center rounded-lg bg-muted/40">
                    <t.icon
                      weight="light"
                      className={cn("size-12 opacity-80", t.color)}
                    />
                  </div>
                  <span className="flex px-3 pb-2">{meta(f)}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </>
  )

  const list = (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div
        className={cn(
          "grid h-9 items-center gap-3 border-b pr-1 pl-3 text-xs font-medium text-muted-foreground select-none",
          COLS
        )}
      >
        <span className="pl-8">Name</span>
        <span className="max-sm:hidden">
          {showWhere ? "Location" : "Modified"}
        </span>
        <span className="max-sm:hidden">Size</span>
      </div>
      <div className="divide-y">
        {items.map((n) => (
          <div
            key={n.id}
            {...itemProps(n)}
            className={cn(
              "group grid h-file-row items-center gap-3 pr-1 pl-3 transition-colors outline-none select-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset aria-selected:bg-brand/8 data-drop:bg-brand/15 data-drop:ring-2 data-drop:ring-brand data-drop:ring-inset",
              COLS
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              {lead(n, "size-5")}
              {label(n)}
            </span>
            <span className="truncate text-sm text-muted-foreground tabular-nums max-sm:hidden">
              {showWhere ? where(n) : when(n.updatedAt)}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums max-sm:hidden">
              {formatBytes(
                n.kind === "folder" ? (sizes.get(n.id) ?? 0) : n.size
              )}
            </span>
            {itemMenu(n)}
          </div>
        ))}
      </div>
    </div>
  )

  // Arrows in the previewer step through what can be previewed here.
  function stepper() {
    const gallery = files.filter(viewable)
    const i = viewing ? gallery.findIndex((g) => g.id === viewing.id) : -1
    if (i < 0) return {}
    return {
      position: `${i + 1} of ${gallery.length}`,
      onPrev: i > 0 ? () => show(gallery[i - 1]) : undefined,
      onNext: i < gallery.length - 1 ? () => show(gallery[i + 1]) : undefined,
    }
  }

  const crumbs = [
    { id: null as string | null, name: vault.name },
    ...(inTrash ? [{ id: "trash", name: "Trash" }] : path),
  ]

  return (
    <div
      data-density={compact ? "compact" : undefined}
      data-tiles={tiles}
      className="relative flex min-h-[calc(100svh-10rem)] flex-col gap-4"
      onDragOver={(e) => {
        if (!osFiles(e) || inTrash) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
        setOsDrag(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOsDrag(false)
      }}
      onDrop={(e) => {
        if (!osFiles(e) || inTrash) return
        e.preventDefault()
        setOsDrag(false)
        readDrop(e.dataTransfer).then((f) => upload(f, folder))
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 flex-auto items-center gap-1 text-2xl font-semibold tracking-tight"
        >
          <Link
            href="/vault"
            aria-label="All vaults"
            title="All vaults"
            className="-ml-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <LockKeyIcon className="size-5" />
          </Link>
          {crumbs.map((c, i) =>
            i === crumbs.length - 1 ? (
              <h1 key={c.id ?? "root"} className="truncate">
                {c.name}
              </h1>
            ) : (
              <span
                key={c.id ?? "root"}
                className="flex min-w-0 shrink items-center gap-1"
              >
                <button
                  type="button"
                  onClick={() => go(c.id)}
                  {...dropTarget(c.id)}
                  className="-mx-1 truncate rounded-md px-1 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-drop:bg-brand/15 data-drop:text-foreground"
                >
                  {c.name}
                </button>
                <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
              </span>
            )
          )}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {inTrash ? (
            <Button
              variant="outline"
              disabled={!trashed.length}
              onClick={() => setDeleting(trashed)}
              className="text-destructive hover:text-destructive"
            >
              <TrashIcon />
              <span className="max-sm:sr-only">Empty trash</span>
            </Button>
          ) : (
            <>
              <Button
                id="new-folder"
                onClick={newFolder}
                title="New folder (Shift+N)"
              >
                <FolderSimplePlusIcon />
                <span className="max-sm:sr-only">New folder</span>
              </Button>
              <Menu.Root>
                <Menu.Trigger render={<Button variant="outline" />}>
                  <UploadSimpleIcon />
                  <span className="max-sm:sr-only">Upload</span>
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner side="bottom" align="end" sideOffset={4}>
                    <Menu.Popup className={`w-48 ${MENU_POPUP}`}>
                      <Menu.Item
                        className={MENU_ITEM}
                        onClick={() => pick("files")}
                      >
                        <FileArrowUpIcon />
                        Files
                      </Menu.Item>
                      <Menu.Item
                        className={MENU_ITEM}
                        onClick={() => pick("folder")}
                      >
                        <UploadSimpleIcon />A folder
                      </Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(new Set())
                  setFilter("")
                  router.push(`/vault/${vault.id}?trash=1`)
                }}
                title="This vault's trash"
              >
                <TrashIcon />
                <span className="max-sm:sr-only">Trash</span>
              </Button>
            </>
          )}
          <Button
            variant="outline"
            onClick={() => lock(vault.id)}
            title="Lock this vault"
          >
            <LockIcon />
            <span className="max-sm:sr-only">Lock</span>
          </Button>
          <Menu.Root>
            <Menu.Trigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Vault settings"
                  title="Vault settings"
                />
              }
            >
              <DotsThreeIcon weight="bold" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner side="bottom" align="end" sideOffset={4}>
                <Menu.Popup className={`w-52 ${MENU_POPUP}`}>
                  <Menu.Item
                    className={MENU_ITEM}
                    onClick={() => setVaultDialog("pass")}
                  >
                    <KeyIcon />
                    Change passphrase…
                  </Menu.Item>
                  <Menu.Separator className="-mx-1 my-1 h-px bg-border" />
                  <Menu.Item
                    className={cn(
                      MENU_ITEM,
                      "text-destructive [&_svg]:text-destructive"
                    )}
                    onClick={() => setVaultDialog("delete")}
                  >
                    <TrashIcon />
                    Delete vault…
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          <Segmented
            label="Layout"
            value={layout}
            onChange={(v) => {
              setLayout(v)
              savePref(LAYOUT_COOKIE, v)
            }}
            options={[
              { value: "list", label: "List", icon: ListBulletsIcon },
              { value: "grid", label: "Grid", icon: SquaresFourIcon },
            ]}
          />
          {layout === "grid" && (
            <Segmented
              label="Tile size"
              value={tiles}
              onChange={(v) => {
                setTiles(v)
                savePref(TILES_COOKIE, v)
              }}
              options={[
                { value: "small", label: "Small tiles", icon: GridNineIcon },
                { value: "medium", label: "Medium tiles", icon: GridFourIcon },
                { value: "large", label: "Large tiles", icon: SquareIcon },
              ]}
            />
          )}
        </div>
      </div>

      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative w-full max-w-xs">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setFilter("")}
            placeholder="Filter this vault by name"
            aria-label="Filter this vault by name"
            className="pl-8"
          />
        </div>
        {sel.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="px-2 text-sm text-muted-foreground tabular-nums">
              {sel.length} selected
            </span>
            {actions(sel)
              .filter((a) => a.label !== "Open")
              .map((a) => (
                <Button
                  key={a.label}
                  variant="ghost"
                  size="sm"
                  onClick={a.run}
                  className={cn(
                    a.danger && "text-destructive hover:text-destructive"
                  )}
                >
                  <a.icon />
                  <span className="max-md:sr-only">{a.label}</span>
                </Button>
              ))}
          </div>
        )}
      </div>

      <ContextMenu.Root>
        <ContextMenu.Trigger
          role="listbox"
          aria-multiselectable
          aria-label={`Contents of ${crumbs[crumbs.length - 1].name}`}
          className="flex flex-1 flex-col gap-6 outline-none"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(new Set())
          }}
          onContextMenu={(e) => {
            const id = (e.target as HTMLElement).closest<HTMLElement>(
              "[data-id]"
            )?.dataset.id
            if (!id) setSelected(new Set())
            else if (!selected.has(id)) selectOnly(id)
          }}
        >
          {loadError ? (
            <Empty
              title="Couldn't open this vault"
              body="Refresh the page to try again."
            />
          ) : !nodes ? (
            <p className="text-sm text-muted-foreground">Decrypting…</p>
          ) : !items.length ? (
            inTrash && !q ? (
              <Empty
                title="Trash is empty"
                body="What you delete from this vault waits here, still encrypted, until you delete it forever."
              />
            ) : q ? (
              <Empty
                title="No matches"
                body={`Nothing in this vault is named like “${filter.trim()}”.`}
              />
            ) : (
              <Empty
                title={folder ? "This folder is empty" : "This vault is empty"}
                body="Drop files here, paste them, or use Upload. They're encrypted before they leave this browser."
              />
            )
          ) : layout === "grid" ? (
            grid
          ) : (
            list
          )}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner>
            <ContextMenu.Popup className={`w-52 ${MENU_POPUP}`}>
              {menu(sel, ContextMenu.Item)}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {osDrag && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl border-2 border-dashed border-brand bg-brand/5">
          <p className="rounded-lg bg-popover px-3 py-2 text-sm font-medium shadow-md">
            Drop to encrypt and upload into {crumbs[crumbs.length - 1].name}
          </p>
        </div>
      )}

      <Previewer
        open={Boolean(viewing)}
        shown={viewing && { item: asItem(viewing) }}
        src={src}
        onClose={closeView}
        {...stepper()}
      />
      <NameDialog
        open={Boolean(naming)}
        item={naming?.item ?? null}
        error={nameErr}
        pending={pending}
        onSubmit={submitName}
        onClose={() => setNaming(null)}
      />
      {moving && (
        <MoveDialog
          vaultName={vault.name}
          moving={moving}
          live={live}
          byId={byId}
          pending={pending}
          onPick={moveTo}
          onClose={() => setMoving(null)}
        />
      )}
      <FilesPicker
        open={Boolean(movingOut)}
        title={`Move ${movingOut?.length === 1 ? `“${movingOut[0].name}”` : plural(movingOut?.length ?? 0, "item")} to My files`}
        moving={[]}
        start={[{ id: null, name: "My files" }]}
        onClose={() => setMovingOut(null)}
        onMove={(to) => {
          const t = movingOut!
          setMovingOut(null)
          moveOut(t, to)
        }}
      />
      {vaultDialog === "pass" && (
        <PassphraseDialog
          vault={vault}
          vk={vk}
          rescued={rescued}
          onRekey={onRekey}
          onDone={(text) => {
            setVaultDialog(null)
            if (text) setNotice({ text })
          }}
        />
      )}
      {vaultDialog === "delete" && (
        <DeleteVaultDialog vault={vault} onClose={() => setVaultDialog(null)} />
      )}
      <Dialog.Root
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && !pending && setDeleting(null)}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <Dialog.Title className="text-base font-semibold">
              Delete{" "}
              {deleting?.length === 1
                ? `“${deleting[0].name}”`
                : plural(deleting?.length ?? 0, "item")}{" "}
              forever?
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              This can&apos;t be undone.
            </Dialog.Description>
            <div className="flex justify-end gap-2">
              <Dialog.Close
                disabled={pending}
                render={<Button variant="outline" />}
              >
                Cancel
              </Dialog.Close>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={confirmDelete}
              >
                Delete forever
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-auto font-sans text-xs text-muted-foreground">
      {children}
    </kbd>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-16 text-center">
      <LockKeyIcon weight="light" className="size-12 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  )
}

// Every folder in the vault except the ones moving and what's inside them.
function MoveDialog({
  vaultName,
  moving,
  live,
  byId,
  pending,
  onPick,
  onClose,
}: {
  vaultName: string
  moving: Entry[]
  live: Entry[]
  byId: Map<string, Entry>
  pending: boolean
  onPick: (id: string | null) => void
  onClose: () => void
}) {
  const [to, setTo] = useState<string | null>(null)
  const ids = new Set(moving.map((m) => m.id))
  const pathOf = (n: Entry) => {
    const names: string[] = []
    for (
      let p: Entry | undefined = n;
      p;
      p = p.parentId ? byId.get(p.parentId) : undefined
    ) {
      if (ids.has(p.id)) return null
      names.unshift(p.name)
    }
    return names.join(" / ")
  }
  const places = live
    .filter((n) => n.kind === "folder")
    .map((n) => ({ id: n.id, path: pathOf(n) }))
    .filter((p): p is { id: string; path: string } => p.path !== null)
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
  const options = [{ id: null as string | null, path: vaultName }, ...places]

  return (
    <Dialog.Root open onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <Dialog.Title className="text-base font-semibold">
            Move{" "}
            {moving.length === 1
              ? `“${moving[0].name}”`
              : plural(moving.length, "item")}
          </Dialog.Title>
          <div
            role="listbox"
            aria-label="Destination"
            className="max-h-72 overflow-y-auto rounded-lg border p-1"
          >
            {options.map((o) => (
              <button
                key={o.id ?? "root"}
                type="button"
                role="option"
                aria-selected={to === o.id}
                onClick={() => setTo(o.id)}
                onDoubleClick={() => onPick(o.id)}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-selected:bg-brand/10 aria-selected:font-medium"
              >
                {o.id ? (
                  <FolderOpenIcon
                    weight="fill"
                    className="size-4 shrink-0 text-file-folder"
                  />
                ) : (
                  <LockKeyIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{o.path}</span>
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Dialog.Close
              disabled={pending}
              render={<Button variant="outline" />}
            >
              Cancel
            </Dialog.Close>
            <Button disabled={pending} onClick={() => onPick(to)}>
              Move here
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Same vault key under a new passphrase; files and the recovery key don't change.
function PassphraseDialog({
  vault,
  vk,
  rescued,
  onRekey,
  onDone,
}: {
  vault: VaultInfo
  vk: CryptoKey
  rescued: boolean
  onRekey: (k: Rekey) => void
  onDone: (notice?: string) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const policy = usePasswordPolicy()

  async function submit(form: FormData) {
    const pass = String(form.get("pass"))
    const problem = passwordProblem(pass, policy, true)
    if (problem) return setError(problem)
    if (pass !== form.get("again"))
      return setError("The passphrases don't match.")
    setPending(true)
    setError(null)
    const k = await rewrap(vk, pass)
    const res = await updateVaultKey(vault.id, k).catch(() => ({
      error: "Couldn't change the passphrase. Try again.",
    }))
    setPending(false)
    if (res.error) return setError(res.error)
    onRekey(k)
    onDone("Passphrase changed. Use the new one next time.")
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && !pending && onDone()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">
              {rescued ? "Set a new passphrase?" : "Change passphrase"}
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              {rescued
                ? "You opened this vault with the recovery key. Pick a new passphrase for next time. The recovery key keeps working."
                : "Your files stay as they are; only what opens the vault changes. The recovery key keeps working."}
            </Dialog.Description>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              submit(new FormData(e.currentTarget))
            }}
          >
            <PassphraseFields label="New passphrase" />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close
                disabled={pending}
                render={<Button variant="outline" />}
              >
                {rescued ? "Not now" : "Cancel"}
              </Dialog.Close>
              <SubmitButton pending={pending}>Save passphrase</SubmitButton>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// The passphrase and the typed name are checked here; the server never sees
// the passphrase, so this is a guard against slips, not against the owner.
function DeleteVaultDialog({
  vault,
  onClose,
}: {
  vault: VaultInfo
  onClose: () => void
}) {
  const router = useRouter()
  const { lock } = useVaultKeys()
  const [typed, setTyped] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(pass: string) {
    setPending(true)
    setError(null)
    try {
      await unlockWithPassphrase(vault, pass)
    } catch {
      setPending(false)
      return setError("That passphrase doesn't open this vault.")
    }
    const res = await deleteVault(vault.id).catch(() => ({
      error: "Couldn't delete the vault. Try again.",
    }))
    if (res.error) {
      setPending(false)
      return setError(res.error)
    }
    lock(vault.id)
    router.push("/vault")
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">
              Delete “{vault.name}”?
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              Every file and folder in it is deleted for good, trash included.
              This can&apos;t be undone.
            </Dialog.Description>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              submit(String(new FormData(e.currentTarget).get("pass")))
            }}
          >
            <div className="grid gap-2">
              <label htmlFor="delete-pass" className="text-sm font-medium">
                Passphrase
              </label>
              <Input
                id="delete-pass"
                name="pass"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor="delete-name" className="text-sm font-medium">
                Type <span className="font-semibold">{vault.name}</span> to
                confirm
              </label>
              <Input
                id="delete-name"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close
                disabled={pending}
                render={<Button variant="outline" />}
              >
                Cancel
              </Dialog.Close>
              <SubmitButton
                variant="destructive"
                pending={pending}
                disabled={typed !== vault.name}
              >
                Delete vault
              </SubmitButton>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
