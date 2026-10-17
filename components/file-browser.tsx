"use client"

import { ContextMenu } from "@base-ui/react/context-menu"
import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import {
  ArrowBendUpRightIcon,
  ArrowDownIcon,
  ArrowsDownUpIcon,
  ArrowUpIcon,
  CalendarBlankIcon,
  HardDrivesIcon,
  ImageSquareIcon,
  ShapesIcon,
  CaretDownIcon,
  InfoIcon,
  ArrowCounterClockwiseIcon,
  ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CheckSquareIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  EyeIcon,
  FolderOpenIcon,
  FolderSimplePlusIcon,
  GridFourIcon,
  GridNineIcon,
  ListBulletsIcon,
  PencilSimpleIcon,
  PlusIcon,
  SquareIcon,
  SquaresFourIcon,
  StarIcon,
  TagIcon,
  TrashIcon,
  UploadSimpleIcon,
  WarningCircleIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useRef, useState, useTransition } from "react"

import {
  createFolder,
  deleteForever,
  emptyTrash,
  moveItems,
  renameItem,
  createTag,
  restoreItems,
  setStarred,
  tagItems,
  trashItems,
} from "@/app/(app)/file-actions"
import type { Version } from "@/app/(app)/upload-actions"
import { DetailsSheet } from "@/components/details-sheet"
import { Previewer, type Shown } from "@/components/previewer"
import { Thumb } from "@/components/thumb"
import { VersionsDialog } from "@/components/versions-dialog"
import { MoveDialog, type Place } from "@/components/move-dialog"
import {
  DENSITY_COOKIE,
  LAYOUT_COOKIE,
  TILES_COOKIE,
} from "@/components/nav-styles"
import {
  DIALOG_BACKDROP,
  DIALOG_POPUP,
  MENU_ITEM,
  MENU_POPUP,
} from "@/components/overlay-styles"
import { SubmitButton } from "@/components/submit-button"
import {
  pastedFiles,
  readDrop,
  takeNewFolderRequest,
  useUploads,
} from "@/components/upload-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { TagColor } from "@/lib/db/schema"
import { TAG_DOT, fileType, formatBytes } from "@/lib/file-types"
import type { Item, Tag } from "@/lib/files"
import { resetThumb, thumbFromFrame, thumbFromImage } from "@/lib/thumbs"
import { cn } from "@/lib/utils"

export type View = "folder" | "recent" | "starred" | "shared" | "trash"
type Layout = "grid" | "list"
type Tiles = "small" | "medium" | "large"
type Act = {
  label: string
  short?: string
  icon: Icon
  kbd?: string
  danger?: boolean
  menuOnly?: boolean
  // Menus put a separator between groups; tags close group 1.
  group?: number
  run: () => void
}
type SortKey = "name" | "date" | "size"
type Notice = { text: string; error?: boolean; undo?: () => void }

const DRAG = "application/x-nimbus-items"
const ROOT: Place = { id: null, name: "My files" }
const DAY = 864e5
const SINCE = [
  { label: "Today", from: () => new Date().setHours(0, 0, 0, 0) },
  { label: "Last 7 days", from: () => Date.now() - 7 * DAY },
  { label: "Last 30 days", from: () => Date.now() - 30 * DAY },
  {
    label: "This year",
    from: () => new Date(new Date().getFullYear(), 0, 1).getTime(),
  },
]
const MB = 1024 ** 2
const SIZES = [
  { label: "Under 1 MB", min: 0, max: MB },
  { label: "1 MB to 100 MB", min: MB, max: 100 * MB },
  { label: "100 MB to 1 GB", min: 100 * MB, max: 1024 * MB },
  { label: "Over 1 GB", min: 1024 * MB, max: Infinity },
]

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
function when(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (sameDay(d, now))
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

export function FileBrowser({
  view,
  items: all,
  title,
  description,
  path = [],
  folderId = null,
  empty,
  tags,
  layout: initialLayout,
  compact: initialCompact,
  tiles: initialTiles,
}: {
  view: View
  items: Item[]
  title: string
  description?: string
  // Folder view: the folders above this one and this one, root excluded.
  path?: { id: string; name: string }[]
  folderId?: string | null
  empty: { title: string; body: string }
  // The viewer's own tags.
  tags: Tag[]
  layout: Layout
  compact: boolean
  tiles: Tiles
}) {
  const router = useRouter()
  const { upload, download } = useUploads()
  const [layout, setLayout] = useState(initialLayout)
  const [compact, setCompact] = useState(initialCompact)
  const [tiles, setTiles] = useState(initialTiles)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  // Selection mode: checkboxes show and clicks toggle. Otherwise a click just
  // highlights one item.
  const [selecting, setSelecting] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  // Rename (an item) or new folder (null id). Kept while the dialog animates out.
  const [naming, setNaming] = useState<{ item: Item | null }>({ item: null })
  const [nameOpen, setNameOpen] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [moving, setMoving] = useState<Item[]>([])
  const [moveOpen, setMoveOpen] = useState(false)
  const [confirm, setConfirm] = useState<{
    ids: string[]
    label: string
  } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dropId, setDropId] = useState<string | null>(null)
  // OS files dragged over the page (folder view), for the drop overlay.
  const [osDrag, setOsDrag] = useState(false)
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [versionsId, setVersionsId] = useState<string | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  // The previewed file, and the older version shown instead, if any.
  const [preview, setPreview] = useState<{
    id: string
    version?: Shown["version"]
  } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>(
    view === "recent" || view === "trash"
      ? { key: "date", desc: true }
      : { key: "name", desc: false }
  )
  const [typeFilter, setTypeFilter] = useState("")
  const [since, setSince] = useState<{ label: string; from: number } | null>(
    null
  )
  const [sizeFilter, setSizeFilter] = useState("")
  const [tagFilter, setTagFilter] = useState("")
  const [tagTargets, setTagTargets] = useState<string[]>([])
  const [tagOpen, setTagOpen] = useState(false)
  const [tagError, setTagError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const dragging = useRef<string[]>([])
  const chip = useRef<HTMLDivElement>(null)
  // "Change thumbnail…": the picker and the file it's for.
  const thumbInput = useRef<HTMLInputElement>(null)
  const thumbFor = useRef<Item | null>(null)

  const canEdit = view !== "trash" && view !== "shared"
  const dateOf = (i: Item) => (view === "trash" ? i.trashedAt! : i.updatedAt)
  const typeOf = (i: Item) => fileType(i.kind, i.mime, i.name)
  const presentTypes = [
    ...new Map(all.map((i) => [typeOf(i).key, typeOf(i)])).values(),
  ]
  const size = SIZES.find((o) => o.label === sizeFilter)
  // What's shown: filtered, then sorted with folders first like Drive.
  const items = all
    .filter(
      (i) =>
        (!typeFilter || typeOf(i).key === typeFilter) &&
        (!since || Date.parse(dateOf(i)) >= since.from) &&
        (!size || (i.size >= size.min && i.size < size.max)) &&
        (!tagFilter || i.tags.includes(tagFilter))
    )
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
      const d =
        sort.key === "name"
          ? a.name.localeCompare(b.name, undefined, {
              numeric: true,
              sensitivity: "base",
            })
          : sort.key === "size"
            ? a.size - b.size
            : Date.parse(dateOf(a)) - Date.parse(dateOf(b))
      return sort.desc ? -d : d
    })
  const filtered = Boolean(typeFilter || since || sizeFilter || tagFilter)
  const detailsItem = all.find((i) => i.id === detailsId) ?? null
  const previewItem = all.find((i) => i.id === preview?.id) ?? null
  const tagById = new Map(tags.map((t) => [t.id, t]))
  const sel = items.filter((i) => selected.has(i.id))
  const folders = items.filter((i) => i.kind === "folder")
  const files = items.filter((i) => i.kind === "file")
  const previewIndex = files.findIndex((f) => f.id === preview?.id)
  const tabStop =
    focusId && items.some((i) => i.id === focusId) ? focusId : items[0]?.id
  const here: Place[] = [ROOT, ...path]

  const label = (list: { name: string }[]) =>
    list.length === 1 ? `“${list[0].name}”` : plural(list.length, "item")

  function run(task: () => Promise<{ error?: string } | void>, done?: Notice) {
    setNotice(null)
    start(async () => {
      const res = await task()
      setNotice(res?.error ? { text: res.error, error: true } : (done ?? null))
    })
  }

  const selectOnly = (id: string) => {
    setSelected(new Set([id]))
    setAnchor(id)
  }
  const clear = () => {
    setSelected(new Set())
    setSelecting(false)
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
    setSelecting(next.size > 0)
    setAnchor(id)
  }

  function selectRange(to: string, add: boolean) {
    const a = items.findIndex((i) => i.id === (anchor ?? to))
    const b = items.findIndex((i) => i.id === to)
    const span = items
      .slice(Math.min(a, b), Math.max(a, b) + 1)
      .map((i) => i.id)
    setSelected(new Set([...(add ? selected : []), ...span]))
    setSelecting(true)
  }

  function selectAll() {
    setSelected(new Set(items.map((i) => i.id)))
    setSelecting(true)
  }

  // Folders open in place; files open in the previewer.
  function open(item: Item) {
    if (item.kind === "file") showPreview(item.id)
    else if (canEdit) router.push(`/folders/${item.id}`)
  }

  function showPreview(id: string, version?: Shown["version"]) {
    setPreview({ id, version })
    setPreviewOpen(true)
  }

  // The current version previews like the file itself, with arrows.
  function previewVersion(id: string, v: Version) {
    showPreview(id, v.current ? undefined : v)
  }

  // Older versions have no neighbours to step to.
  function previewAt(step: number) {
    const next = preview?.version ? undefined : files[previewIndex + step]
    return next && previewIndex >= 0 ? () => showPreview(next.id) : undefined
  }

  function newFolder() {
    clear()
    setNaming({ item: null })
    setNameError(null)
    setNameOpen(true)
  }

  function rename(item: Item) {
    setNaming({ item })
    setNameError(null)
    setNameOpen(true)
  }

  function submitName(value: string) {
    const { item } = naming
    start(async () => {
      const res = item
        ? await renameItem(item.id, value)
        : await createFolder(folderId, value)
      if (res.error) return setNameError(res.error)
      setNameOpen(false)
    })
  }

  function trash(list: Item[]) {
    const ids = list.map((i) => i.id)
    clear()
    run(() => trashItems(ids), {
      text: `Moved ${label(list)} to the trash.`,
      undo: () => run(() => restoreItems(ids)),
    })
  }

  function star(list: Item[]) {
    const on = !list.every((i) => i.starred)
    run(() =>
      setStarred(
        list.map((i) => i.id),
        on
      )
    )
  }

  function restore(list: Item[]) {
    clear()
    run(() => restoreItems(list.map((i) => i.id)), {
      text: `Restored ${label(list)}.`,
    })
  }

  function askDelete(ids: string[], what: string) {
    setConfirm({ ids, label: what })
    setConfirmOpen(true)
  }

  function confirmDelete() {
    if (!confirm) return
    const { ids } = confirm
    start(async () => {
      await (ids.length ? deleteForever(ids) : emptyTrash())
      clear()
      setConfirmOpen(false)
    })
  }

  function move(list: Item[]) {
    setMoving(list)
    setMoveOpen(true)
  }

  function moveTo(ids: string[], to: Place, what: string) {
    run(() => moveItems(ids, to.id), { text: `Moved ${what} to ${to.name}.` })
  }

  // Thumbnail changes save straight to S3, then the page refreshes to show them.
  function thumbTask(item: Item, task: () => Promise<unknown>, verb: string) {
    run(
      async () => {
        try {
          await task()
          router.refresh()
        } catch (e) {
          return { error: (e as Error).message }
        }
      },
      { text: `${verb} the thumbnail of “${item.name}”.` }
    )
  }

  function pickThumb(item: Item) {
    thumbFor.current = item
    thumbInput.current!.value = ""
    thumbInput.current!.click()
  }

  function showVersions(item: Item) {
    setVersionsId(item.id)
    setVersionsOpen(true)
  }

  function showDetails(item: Item) {
    setDetailsId(item.id)
    setDetailsOpen(true)
  }

  function newTag(ids: string[]) {
    setTagTargets(ids)
    setTagError(null)
    setTagOpen(true)
  }

  function submitTag(name: string, color: TagColor) {
    start(async () => {
      const res = await createTag(name, color, tagTargets)
      if (res.error) return setTagError(res.error)
      setTagOpen(false)
    })
  }

  // Checkbox list of the viewer's tags for the given items, plus "New tag…".
  function tagList(t: Item[]) {
    const ids = t.map((i) => i.id)
    return (
      <>
        {tags.map((tag) => (
          <Menu.CheckboxItem
            key={tag.id}
            checked={t.every((i) => i.tags.includes(tag.id))}
            onCheckedChange={(on) => run(() => tagItems(ids, tag.id, on))}
            closeOnClick={false}
            className={cn(MENU_ITEM, "relative pr-8")}
          >
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                TAG_DOT[tag.color]
              )}
            />
            <span className="truncate">{tag.name}</span>
            <Menu.CheckboxItemIndicator className="absolute right-2">
              <CheckIcon />
            </Menu.CheckboxItemIndicator>
          </Menu.CheckboxItem>
        ))}
        {tags.length > 0 && (
          <Menu.Separator className="-mx-1 my-1 h-px bg-border" />
        )}
        <Menu.Item className={MENU_ITEM} onClick={() => newTag(ids)}>
          <PlusIcon />
          New tag…
        </Menu.Item>
      </>
    )
  }

  function tagSubmenu(t: Item[]) {
    if (view === "trash") return null
    return (
      <Menu.SubmenuRoot>
        <Menu.SubmenuTrigger
          className={cn(MENU_ITEM, "data-popup-open:bg-accent")}
        >
          <TagIcon />
          Tags
          <CaretRightIcon className="ml-auto size-3.5" />
        </Menu.SubmenuTrigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={4} alignOffset={-4}>
            <Menu.Popup
              className={`max-h-80 w-52 overflow-y-auto ${MENU_POPUP}`}
            >
              {tagList(t)}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.SubmenuRoot>
    )
  }

  function actions(t: Item[]): Act[] {
    if (!t.length) return []
    const info: Act | null =
      t.length === 1
        ? {
            label: "Details",
            icon: InfoIcon,
            kbd: "I",
            run: () => showDetails(t[0]),
          }
        : null
    if (view === "shared") return info ? [info] : []
    if (view === "trash")
      return [
        ...(info ? [info] : []),
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
          group: 1,
          run: () =>
            askDelete(
              t.map((i) => i.id),
              label(t)
            ),
        },
      ]
    const one = t.length === 1 ? t[0] : null
    const starred = t.every((i) => i.starred)
    const list: (Act | false | null)[] = [
      one && {
        label: one.kind === "folder" ? "Open" : "Preview",
        icon: one.kind === "folder" ? FolderOpenIcon : EyeIcon,
        kbd: "Enter",
        menuOnly: true,
        run: () => open(one),
      },
      {
        label: "Download",
        icon: DownloadSimpleIcon,
        run: () => download(t),
      },
      one && {
        label: "Rename",
        icon: PencilSimpleIcon,
        kbd: "F2",
        group: 1,
        run: () => rename(one),
      },
      {
        label: "Move",
        icon: ArrowBendUpRightIcon,
        group: 1,
        run: () => move(t),
      },
      {
        label: starred ? "Remove from starred" : "Add to starred",
        short: starred ? "Unstar" : "Star",
        icon: StarIcon,
        kbd: "S",
        group: 1,
        run: () => star(t),
      },
      info && { ...info, group: 2 },
      one?.kind === "file" && {
        label: "Versions…",
        icon: ClockCounterClockwiseIcon,
        menuOnly: true,
        group: 2,
        run: () => showVersions(one),
      },
      one?.kind === "file" && {
        label: "Change thumbnail…",
        icon: ImageSquareIcon,
        menuOnly: true,
        group: 2,
        run: () => pickThumb(one),
      },
      one?.thumb
        ? {
            label: "Reset thumbnail",
            icon: ArrowCounterClockwiseIcon,
            menuOnly: true,
            group: 2,
            run: () => thumbTask(one, () => resetThumb(one), "Reset"),
          }
        : null,
      {
        label: "Move to trash",
        short: "Trash",
        icon: TrashIcon,
        kbd: "Del",
        danger: true,
        group: 3,
        run: () => trash(t),
      },
    ]
    return list.filter((a): a is Act => Boolean(a))
  }

  function menuItems(t: Item[]) {
    const acts = actions(t)
    if (!acts.length)
      return (
        <>
          {view === "folder" && (
            <Menu.Item className={MENU_ITEM} onClick={newFolder}>
              <FolderSimplePlusIcon />
              New folder
              <Kbd>Shift N</Kbd>
            </Menu.Item>
          )}
          {view === "trash" && all.length > 0 && (
            <Menu.Item
              className={MENU_ITEM}
              onClick={() => askDelete([], "everything in the trash")}
            >
              <TrashIcon />
              Empty trash
            </Menu.Item>
          )}
          <Menu.Item
            className={MENU_ITEM}
            disabled={!items.length}
            onClick={selectAll}
          >
            <CheckIcon />
            Select all
            <Kbd>Ctrl A</Kbd>
          </Menu.Item>
        </>
      )
    const group = (i: number) => acts[i]?.group ?? 0
    return (
      <>
        {acts.map((a, i) => (
          <Fragment key={a.label}>
            {i > 0 && group(i - 1) === 1 && group(i) !== 1 && tagSubmenu(t)}
            {i > 0 && group(i - 1) !== group(i) && (
              <Menu.Separator className="-mx-1 my-1 h-px bg-border" />
            )}
            <Menu.Item
              className={cn(
                MENU_ITEM,
                a.danger && "text-destructive [&_svg]:text-destructive"
              )}
              onClick={a.run}
            >
              <a.icon />
              {a.label}
              {a.kbd && <Kbd>{a.kbd}</Kbd>}
            </Menu.Item>
          </Fragment>
        ))}
        {group(acts.length - 1) === 1 && tagSubmenu(t)}
      </>
    )
  }

  // Shift+N makes a folder from anywhere on the page.
  useEffect(() => {
    if (view !== "folder") return
    function onKey(e: KeyboardEvent) {
      if (
        e.key === "N" &&
        e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !busyTarget(e.target)
      ) {
        e.preventDefault()
        document.getElementById("new-folder")?.click()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [view])

  // Sidebar New › New folder from another view lands here, then opens the dialog.
  useEffect(() => {
    if (view === "folder" && takeNewFolderRequest())
      document.getElementById("new-folder")?.click()
  }, [view])

  // Ctrl/Cmd+V with files on the clipboard uploads them here.
  useEffect(() => {
    if (view !== "folder") return
    function onPaste(e: ClipboardEvent) {
      if (busyTarget(e.target)) return
      const files = pastedFiles(e)
      if (!files.length) return
      e.preventDefault()
      upload(files, folderId)
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [view, folderId, upload])

  // Nearest item in the next or previous visual row, for arrow keys in the grid.
  function vertical(cur: number, dir: 1 | -1) {
    const rects = items.map((i) =>
      document.getElementById(`item-${i.id}`)!.getBoundingClientRect()
    )
    const r = rects[cur]
    const x = r.left + r.width / 2
    let best = cur
    let score = Infinity
    rects.forEach((b, j) => {
      const dy = dir > 0 ? b.top - r.bottom : r.top - b.bottom
      if (dy < -1) return
      const s = dy * 1e4 + Math.abs(b.left + b.width / 2 - x)
      if (s < score) [score, best] = [s, j]
    })
    return best
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (busyTarget(e.target)) return
    const cur = items.findIndex((i) => i.id === focusId)
    const item = items[cur]
    const mod = e.metaKey || e.ctrlKey
    let next = -1
    switch (e.key) {
      case "ArrowRight":
      case "ArrowLeft":
        if (layout === "list") return
        next =
          cur < 0
            ? 0
            : Math.min(
                Math.max(cur + (e.key === "ArrowRight" ? 1 : -1), 0),
                items.length - 1
              )
        break
      case "ArrowDown":
      case "ArrowUp": {
        const dir = e.key === "ArrowDown" ? 1 : -1
        if (cur < 0) next = 0
        else if (layout === "list")
          next = Math.min(Math.max(cur + dir, 0), items.length - 1)
        else next = vertical(cur, dir)
        break
      }
      case "Home":
        next = 0
        break
      case "End":
        next = items.length - 1
        break
      case "Enter":
        if (item) open(item)
        break
      case " ":
        if (item) toggle(item.id)
        break
      case "Escape":
        clear()
        break
      case "a":
        if (!mod) return
        selectAll()
        break
      case "F2":
        if (canEdit && sel.length === 1) rename(sel[0])
        break
      case "Delete":
      case "Backspace":
        if (!sel.length) return
        if (view === "trash")
          askDelete(
            sel.map((i) => i.id),
            label(sel)
          )
        else if (canEdit) trash(sel)
        break
      case "i":
      case "I":
        if (mod || sel.length !== 1) return
        showDetails(sel[0])
        break
      case "s":
      case "S":
        if (mod || !canEdit || !sel.length) return
        star(sel)
        break
      default:
        return
    }
    e.preventDefault()
    if (next < 0 || !items[next]) return
    const id = items[next].id
    setFocusId(id)
    document.getElementById(`item-${id}`)?.focus()
    if (e.shiftKey) selectRange(id, false)
    else if (!mod && !selecting) selectOnly(id)
  }

  function onClick(e: React.MouseEvent, item: Item) {
    setFocusId(item.id)
    if (selecting && !e.shiftKey) toggle(item.id)
    else if ((e.nativeEvent as PointerEvent).pointerType === "touch") {
      if (item.kind === "folder" && canEdit) open(item)
      else selectOnly(item.id)
    } else if (e.shiftKey) selectRange(item.id, e.metaKey || e.ctrlKey)
    else if (e.metaKey || e.ctrlKey) toggle(item.id)
    else selectOnly(item.id)
  }

  function onContextMenu(e: React.MouseEvent) {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")
      ?.dataset.id
    if (!id) clear()
    else if (!selected.has(id)) selectOnly(id)
  }

  function dragStart(e: React.DragEvent, item: Item) {
    const list = selected.has(item.id) ? sel : [item]
    if (!selected.has(item.id)) selectOnly(item.id)
    dragging.current = list.map((i) => i.id)
    e.dataTransfer.setData(DRAG, JSON.stringify(dragging.current))
    e.dataTransfer.effectAllowed = "move"
    if (chip.current) {
      chip.current.textContent =
        list.length === 1 ? list[0].name : plural(list.length, "item")
      e.dataTransfer.setDragImage(chip.current, -12, -12)
    }
  }

  const osFiles = (e: React.DragEvent) =>
    view === "folder" &&
    e.dataTransfer.types.includes("Files") &&
    !e.dataTransfer.types.includes(DRAG)

  // Folders and breadcrumbs take drops of items dragged from this page, and in
  // the folder view, files dragged in from the OS (uploaded into that folder).
  function dropTarget(to: Place) {
    const key = to.id ?? "root"
    if (!canEdit) return {}
    return {
      "data-drop": dropId === key || undefined,
      onDragOver(e: React.DragEvent) {
        if (osFiles(e)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = "copy"
          setOsDrag(true)
          setDropId(key)
          return
        }
        if (
          !e.dataTransfer.types.includes(DRAG) ||
          (to.id && dragging.current.includes(to.id))
        )
          return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        setDropId(key)
      },
      onDragLeave(e: React.DragEvent) {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropId(null)
      },
      onDrop(e: React.DragEvent) {
        e.preventDefault()
        setDropId(null)
        if (osFiles(e)) {
          e.stopPropagation()
          setOsDrag(false)
          readDrop(e.dataTransfer).then((files) => upload(files, to.id))
          return
        }
        const ids: string[] = JSON.parse(e.dataTransfer.getData(DRAG) || "[]")
        if (!ids.length || (to.id && ids.includes(to.id))) return
        moveTo(ids, to, label(items.filter((i) => ids.includes(i.id))))
      },
    }
  }

  function itemProps(item: Item) {
    const isSelected = selected.has(item.id)
    return {
      id: `item-${item.id}`,
      "data-id": item.id,
      role: "option",
      "aria-selected": isSelected,
      "aria-busy": (pending && isSelected) || undefined,
      tabIndex: tabStop === item.id ? 0 : -1,
      draggable: canEdit,
      onClick: (e: React.MouseEvent) => onClick(e, item),
      onDoubleClick: () => open(item),
      onFocus: () => setFocusId(item.id),
      onDragStart: (e: React.DragEvent) => dragStart(e, item),
      onDragEnd: () => {
        dragging.current = []
        setDropId(null)
      },
      ...(item.kind === "folder" ? dropTarget(item) : {}),
    }
  }

  // The leading icon turns into a checkbox on hover and while anything is selected.
  function lead(item: Item, size: string) {
    const t = fileType(item.kind, item.mime, item.name)
    return (
      <span className={cn("relative grid shrink-0 place-items-center", size)}>
        <t.icon
          weight={item.kind === "folder" ? "fill" : "regular"}
          className={cn(
            "size-full",
            t.color,
            canEdit &&
              "group-hover:invisible group-data-[selecting=true]/browser:invisible"
          )}
        />
        {canEdit && (
          <span
            aria-hidden
            onClick={(e) => {
              e.stopPropagation()
              toggle(item.id)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="invisible absolute inset-0 m-auto grid size-4 place-items-center rounded-[4px] border border-input bg-background text-primary-foreground group-hover:visible group-aria-selected:border-primary group-aria-selected:bg-primary group-data-[selecting=true]/browser:visible"
          >
            <CheckIcon
              weight="bold"
              className="size-3 opacity-0 group-aria-selected:opacity-100"
            />
          </span>
        )}
      </span>
    )
  }

  function name(item: Item) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="truncate text-sm font-medium" title={item.name}>
          {item.name}
        </span>
        {item.starred && view !== "starred" && (
          <StarIcon
            weight="fill"
            aria-label="Starred"
            className="size-3 shrink-0 text-muted-foreground"
          />
        )}
        {item.tags.length > 0 && (
          <span className="flex shrink-0 -space-x-0.5" title={tagNames(item)}>
            <span className="sr-only">Tags: {tagNames(item)}</span>
            {item.tags.slice(0, 3).map((id) => {
              const tag = tagById.get(id)
              return (
                tag && (
                  <span
                    key={id}
                    aria-hidden
                    className={cn(
                      "size-2 rounded-full ring-2 ring-background",
                      TAG_DOT[tag.color]
                    )}
                  />
                )
              )
            })}
          </span>
        )}
      </span>
    )
  }

  const tagNames = (item: Item) =>
    item.tags.map((id) => tagById.get(id)?.name).join(", ")

  // Date and size under a tile's name.
  function meta(item: Item) {
    return (
      <span
        suppressHydrationWarning
        className="truncate text-xs text-muted-foreground tabular-nums"
      >
        {when(dateOf(item))} ·{" "}
        <span className="tabular-nums">{formatBytes(item.size)}</span>
      </span>
    )
  }

  // `shown` keeps the trigger visible, as in the previewer's top bar.
  function itemMenu(item: Item, shown = false) {
    if (!actions([item]).length) return null
    return (
      <Menu.Root
        onOpenChange={(o) => o && !selected.has(item.id) && selectOnly(item.id)}
      >
        <Menu.Trigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              tabIndex={shown ? undefined : -1}
              aria-label={`More for ${item.name}`}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className={cn(
                "shrink-0",
                !shown &&
                  "opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
              )}
            />
          }
        >
          <DotsThreeIcon weight="bold" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4}>
            <Menu.Popup className={`w-56 ${MENU_POPUP}`}>
              {menuItems(sel.length ? sel : [item])}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    )
  }

  const TILE =
    "group relative rounded-xl border outline-none transition-colors select-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-selected:border-brand/60 aria-selected:bg-brand/8 aria-busy:opacity-60 data-drop:border-brand data-drop:bg-brand/15"

  const grid = (
    <>
      {folders.length > 0 && (
        <section
          role="group"
          aria-labelledby="folders-heading"
          className="flex flex-col gap-2"
        >
          <h2
            id="folders-heading"
            className="text-sm font-medium text-muted-foreground"
          >
            Folders
          </h2>
          <div className="grid grid-cols-2 gap-gap-ui sm:grid-cols-[repeat(auto-fill,minmax(var(--tile),1fr))]">
            {folders.map((f) => (
              <div
                key={f.id}
                {...itemProps(f)}
                className={cn(TILE, "flex items-center gap-3 py-2 pr-1 pl-3")}
              >
                {lead(f, "size-5")}
                <span className="flex min-w-0 flex-1 flex-col">
                  {name(f)}
                  {meta(f)}
                </span>
                {itemMenu(f)}
              </div>
            ))}
          </div>
        </section>
      )}
      {files.length > 0 && (
        <section
          role="group"
          aria-labelledby="files-heading"
          className="flex flex-col gap-2"
        >
          <h2
            id="files-heading"
            className="text-sm font-medium text-muted-foreground"
          >
            Files
          </h2>
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
                    {name(f)}
                    {itemMenu(f)}
                  </div>
                  <Thumb
                    item={f}
                    make={canEdit}
                    className="mx-1.5 mb-1.5 grid aspect-[4/3] place-items-center rounded-lg bg-muted/40"
                  >
                    <t.icon
                      weight="light"
                      className={cn("size-12 opacity-80", t.color)}
                    />
                  </Thumb>
                  <span className="flex px-3 pb-2">{meta(f)}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </>
  )

  const second =
    view === "trash"
      ? { head: "Trashed", cell: (i: Item) => when(i.trashedAt!) }
      : view === "shared"
        ? { head: "Owner", cell: (i: Item) => i.owner ?? "" }
        : { head: "Modified", cell: (i: Item) => when(i.updatedAt) }
  const COLS =
    "grid-cols-[minmax(0,1fr)_2rem] sm:grid-cols-[minmax(0,1fr)_9rem_6rem_2rem]"

  const sortBy = (key: SortKey) =>
    setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))

  // Column headers sort the list; the arrow shows the current order.
  function sortHead(
    k: SortKey,
    children: string,
    className?: string,
    disabled?: boolean
  ) {
    if (disabled) return <span className={className}>{children}</span>
    const Arrow = sort.desc ? ArrowDownIcon : ArrowUpIcon
    return (
      <span className={className}>
        <button
          type="button"
          onClick={() => sortBy(k)}
          aria-label={`Sort by ${children.toLowerCase()}`}
          className={cn(
            "-mx-1 inline-flex items-center gap-1 rounded-md px-1 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            sort.key === k && "text-foreground"
          )}
        >
          {children}
          {sort.key === k && <Arrow className="size-3" />}
        </button>
      </span>
    )
  }

  const list = (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div
        className={cn(
          "grid h-9 items-center gap-3 border-b pr-1 pl-3 text-xs font-medium text-muted-foreground",
          COLS
        )}
      >
        {sortHead("name", "Name", "pl-8")}
        {sortHead("date", second.head, "max-sm:hidden", view === "shared")}
        {sortHead("size", "Size", "max-sm:hidden")}
      </div>
      <div className="divide-y">
        {items.map((i) => (
          <div
            key={i.id}
            {...itemProps(i)}
            className={cn(
              "group grid h-file-row items-center gap-3 pr-1 pl-3 transition-colors outline-none select-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset aria-busy:opacity-60 aria-selected:bg-brand/8 data-drop:bg-brand/15 data-drop:ring-2 data-drop:ring-brand data-drop:ring-inset",
              COLS
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              {lead(i, "size-5")}
              {name(i)}
            </span>
            <span
              suppressHydrationWarning
              className="truncate text-sm text-muted-foreground tabular-nums max-sm:hidden"
            >
              {second.cell(i)}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums max-sm:hidden">
              {formatBytes(i.size)}
            </span>
            {itemMenu(i) ?? <span />}
          </div>
        ))}
      </div>
    </div>
  )

  const summary = [
    folders.length && plural(folders.length, "folder"),
    files.length && plural(files.length, "file"),
  ]
    .filter(Boolean)
    .join(" · ")

  const crumbs = here.length > 4 ? [here[0], null, ...here.slice(-2)] : here
  const dropName =
    dropId === "root"
      ? ROOT.name
      : (dropId &&
          (
            items.find((i) => i.id === dropId) ??
            path.find((p) => p.id === dropId)
          )?.name) ||
        here[here.length - 1].name

  return (
    <div
      data-density={compact ? "compact" : undefined}
      data-tiles={tiles}
      className="relative flex min-h-[calc(100svh-10rem)] flex-col gap-4"
      onDragOver={(e) => {
        if (!osFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
        setOsDrag(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOsDrag(false)
      }}
      onDrop={(e) => {
        if (!osFiles(e)) return
        e.preventDefault()
        setOsDrag(false)
        readDrop(e.dataTransfer).then((files) => upload(files, folderId))
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          {view === "folder" && path.length > 0 ? (
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 items-center gap-1 text-2xl font-semibold tracking-tight"
            >
              {crumbs.map((c, i) =>
                c === null ? (
                  <span
                    key="gap"
                    className="flex items-center gap-1 text-muted-foreground"
                  >
                    …<CaretRightIcon className="size-4" />
                  </span>
                ) : i === crumbs.length - 1 ? (
                  <h1 key={c.id ?? "root"} className="truncate">
                    {c.name}
                  </h1>
                ) : (
                  <span
                    key={c.id ?? "root"}
                    className="flex min-w-0 shrink items-center gap-1"
                  >
                    <Link
                      href={c.id ? `/folders/${c.id}` : "/"}
                      {...dropTarget(c)}
                      className="-mx-1 truncate rounded-md px-1 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-drop:bg-brand/15 data-drop:text-foreground"
                    >
                      {c.name}
                    </Link>
                    <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
                  </span>
                )
              )}
            </nav>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === "folder" && (
            <Button
              id="new-folder"
              onClick={newFolder}
              title="New folder (Shift+N)"
            >
              <FolderSimplePlusIcon />
              <span className="max-sm:sr-only">New folder</span>
            </Button>
          )}
          {view === "trash" && all.length > 0 && (
            <Button
              variant="outline"
              onClick={() => askDelete([], "everything in the trash")}
            >
              <TrashIcon />
              Empty trash
            </Button>
          )}
          {items.length > 0 && (
            <Button
              variant="outline"
              aria-pressed={selecting}
              onClick={() => {
                setSelected(new Set())
                setSelecting(!selecting)
              }}
              className="aria-pressed:border-brand/40 aria-pressed:bg-brand/10 dark:aria-pressed:border-brand/40 dark:aria-pressed:bg-brand/10"
            >
              <CheckSquareIcon />
              <span className="max-sm:sr-only">Select</span>
            </Button>
          )}
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
          <Segmented
            label="Density"
            value={compact ? "compact" : "comfortable"}
            onChange={(v) => {
              setCompact(v === "compact")
              savePref(DENSITY_COOKIE, v)
            }}
            options={[
              {
                value: "comfortable",
                label: "Comfortable",
                icon: ArrowsOutLineVerticalIcon,
              },
              {
                value: "compact",
                label: "Compact",
                icon: ArrowsInLineVerticalIcon,
              },
            ]}
          />
        </div>
      </div>

      {description && (
        <p className="-mt-2 text-sm text-muted-foreground">{description}</p>
      )}

      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
        {selecting ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Stop selecting"
              title="Stop selecting (Esc)"
              onClick={clear}
            >
              <XIcon />
            </Button>
            <span className="pr-1 text-sm font-medium tabular-nums">
              {sel.length ? `${sel.length} selected` : "Select items"}
            </span>
            {sel.length < items.length && (
              <Button
                variant="link"
                size="sm"
                className="px-1 text-muted-foreground hover:text-foreground"
                onClick={selectAll}
              >
                Select all
              </Button>
            )}
            {actions(sel)
              .filter((a) => !a.menuOnly)
              .map((a) => (
                <Button
                  key={a.label}
                  variant="ghost"
                  size="sm"
                  onClick={a.run}
                  title={a.kbd ? `${a.label} (${a.kbd})` : a.label}
                  className={cn(
                    a.danger && "text-destructive hover:text-destructive"
                  )}
                >
                  <a.icon />
                  <span className="max-sm:sr-only">{a.short ?? a.label}</span>
                </Button>
              ))}
            {view !== "trash" && sel.length > 0 && (
              <Menu.Root>
                <Menu.Trigger
                  render={<Button variant="ghost" size="sm" title="Tags" />}
                >
                  <TagIcon />
                  <span className="max-sm:sr-only">Tags</span>
                </Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner side="bottom" align="start" sideOffset={4}>
                    <Menu.Popup
                      className={`max-h-80 w-52 overflow-y-auto ${MENU_POPUP}`}
                    >
                      {tagList(sel)}
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Pick
              label="Type"
              icon={ShapesIcon}
              value={typeFilter}
              onChange={setTypeFilter}
              options={presentTypes.map((t) => ({
                value: t.key,
                label: t.label,
                icon: (
                  <t.icon
                    weight={t.key === "folder" ? "fill" : "regular"}
                    className={t.color}
                  />
                ),
              }))}
              anyLabel="Any type"
            />
            <Pick
              label={view === "trash" ? "Trashed" : "Modified"}
              icon={CalendarBlankIcon}
              value={since?.label ?? ""}
              onChange={(v) => {
                const opt = SINCE.find((o) => o.label === v)
                setSince(opt ? { label: opt.label, from: opt.from() } : null)
              }}
              options={SINCE.map((o) => ({ value: o.label, label: o.label }))}
              anyLabel="Any time"
            />
            <Pick
              label="Size"
              icon={HardDrivesIcon}
              value={sizeFilter}
              onChange={setSizeFilter}
              options={SIZES.map((o, n) => ({
                value: o.label,
                label: o.label,
                icon: <Bars n={n + 1} />,
              }))}
              anyLabel="Any size"
            />
            <Pick
              label="Tags"
              icon={TagIcon}
              value={tagFilter}
              onChange={setTagFilter}
              options={tags.map((t) => ({
                value: t.id,
                label: t.name,
                icon: (
                  <span className="grid size-4 place-items-center">
                    <span
                      className={cn("size-2.5 rounded-full", TAG_DOT[t.color])}
                    />
                  </span>
                ),
              }))}
              anyLabel={tags.length ? "Any tag" : undefined}
              extra={
                !tags.length && (
                  <p className="max-w-60 px-2 pb-1.5 text-sm text-muted-foreground">
                    No tags yet. Right-click a file or folder, then choose Tags
                    › New tag.
                  </p>
                )
              }
            />
            {[typeFilter, since, sizeFilter, tagFilter].filter(Boolean).length >
              1 && (
              <Button
                variant="link"
                size="sm"
                className="h-8 px-1 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setTypeFilter("")
                  setSince(null)
                  setSizeFilter("")
                  setTagFilter("")
                }}
              >
                Clear all
              </Button>
            )}
            <p className="pl-1 text-sm text-muted-foreground tabular-nums">
              {summary}
            </p>
          </div>
        )}
        <div
          aria-live="polite"
          className="ml-auto flex min-w-0 items-center gap-2 text-sm"
        >
          {notice && (
            <>
              {notice.error ? (
                <WarningCircleIcon className="size-4 shrink-0 text-destructive" />
              ) : (
                <CheckCircleIcon className="size-4 shrink-0 text-brand" />
              )}
              <span
                className={
                  notice.error ? "text-destructive" : "text-muted-foreground"
                }
              >
                {notice.text}
              </span>
              {notice.undo && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  onClick={notice.undo}
                >
                  Undo
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Dismiss"
                onClick={() => setNotice(null)}
              >
                <XIcon />
              </Button>
            </>
          )}
        </div>
        <Pick
          label="Sort by"
          icon={ArrowsDownUpIcon}
          value={sort.key}
          onChange={(v) => setSort((s) => ({ ...s, key: v as SortKey }))}
          options={[
            { value: "name", label: "Name" },
            ...(view === "shared"
              ? []
              : [{ value: "date", label: second.head }]),
            { value: "size", label: "Size" },
          ]}
          display={
            <>
              {{ name: "Name", date: second.head, size: "Size" }[sort.key]}
              {sort.desc ? (
                <ArrowDownIcon className="size-3.5 text-muted-foreground" />
              ) : (
                <ArrowUpIcon className="size-3.5 text-muted-foreground" />
              )}
            </>
          }
          extra={
            <Menu.RadioGroup
              value={sort.desc ? "desc" : "asc"}
              onValueChange={(v) =>
                setSort((s) => ({ ...s, desc: v === "desc" }))
              }
            >
              <Menu.Separator className="-mx-1 my-1 h-px bg-border" />
              <PickItem value="asc">
                {sort.key === "name"
                  ? "A to Z"
                  : sort.key === "size"
                    ? "Smallest first"
                    : "Oldest first"}
              </PickItem>
              <PickItem value="desc">
                {sort.key === "name"
                  ? "Z to A"
                  : sort.key === "size"
                    ? "Largest first"
                    : "Newest first"}
              </PickItem>
            </Menu.RadioGroup>
          }
        />
      </div>

      <ContextMenu.Root>
        <ContextMenu.Trigger
          render={
            <div
              role="listbox"
              aria-multiselectable
              aria-label={title}
              data-selecting={selecting}
              onKeyDown={onKeyDown}
              onContextMenu={onContextMenu}
              onClick={(e) => e.target === e.currentTarget && clear()}
              className="group/browser flex min-h-[50svh] flex-col gap-6 pb-6 outline-none"
            />
          }
        >
          {items.length === 0 && filtered && all.length > 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-input px-6 py-16 text-center">
              <h2 className="font-medium">Nothing matches these filters</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTypeFilter("")
                  setSince(null)
                  setSizeFilter("")
                  setTagFilter("")
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-input px-6 py-16 text-center">
              <span className="mb-2 grid size-10 place-items-center rounded-lg bg-muted">
                <FolderOpenIcon className="size-5 text-file-folder" />
              </span>
              <h2 className="font-medium">{empty.title}</h2>
              <p className="max-w-sm text-sm text-balance text-muted-foreground">
                {empty.body}
              </p>
            </div>
          ) : layout === "grid" ? (
            grid
          ) : (
            list
          )}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner>
            <ContextMenu.Popup className={`w-56 ${MENU_POPUP}`}>
              {menuItems(sel)}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {osDrag && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-2 z-20 rounded-xl border-2 border-dashed border-brand/70 bg-brand/5"
        >
          <p className="fixed bottom-8 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg">
            <UploadSimpleIcon className="size-4 shrink-0" />
            <span className="truncate">Drop to upload to {dropName}</span>
          </p>
        </div>
      )}

      <div
        ref={chip}
        aria-hidden
        className="pointer-events-none fixed -top-40 left-0 max-w-60 truncate rounded-md bg-primary px-2.5 py-1 text-sm font-medium text-primary-foreground shadow-md"
      />

      <MoveDialog
        open={moveOpen}
        title={`Move ${label(moving)}`}
        moving={moving.map((i) => i.id)}
        start={view === "folder" ? here : [ROOT]}
        onClose={() => setMoveOpen(false)}
        onMove={(to) => {
          setMoveOpen(false)
          clear()
          moveTo(
            moving.map((i) => i.id),
            to,
            label(moving)
          )
        }}
      />

      <DetailsSheet
        item={detailsItem}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        tags={view === "trash" ? null : tags}
        editable={canEdit}
        onAllVersions={() => detailsItem && showVersions(detailsItem)}
        onPreviewVersion={(v) =>
          detailsItem && previewVersion(detailsItem.id, v)
        }
        onTag={(tagId, on) =>
          detailsItem && run(() => tagItems([detailsItem.id], tagId, on))
        }
        onNewTag={() => detailsItem && newTag([detailsItem.id])}
      />

      <input
        ref={thumbInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          const item = thumbFor.current
          if (file && item)
            thumbTask(item, () => thumbFromImage(item, file), "Changed")
        }}
      />

      <VersionsDialog
        item={all.find((i) => i.id === versionsId) ?? null}
        open={versionsOpen}
        editable={canEdit}
        onClose={() => setVersionsOpen(false)}
        onPreview={(v) => versionsId && previewVersion(versionsId, v)}
      />

      <Previewer
        shown={previewItem && { item: previewItem, version: preview?.version }}
        // A file trashed or moved away from the previewer closes it.
        open={previewOpen && Boolean(previewItem)}
        onClose={() => setPreviewOpen(false)}
        onPrev={previewAt(-1)}
        onNext={previewAt(1)}
        position={
          previewIndex >= 0 && files.length > 1
            ? `${previewIndex + 1} of ${files.length}`
            : undefined
        }
        onDetails={previewItem ? () => showDetails(previewItem) : undefined}
        menu={previewItem && itemMenu(previewItem, true)}
        onUseFrame={
          canEdit
            ? async (item, video) => {
                await thumbFromFrame(item, video)
                router.refresh()
              }
            : undefined
        }
      />

      <TagDialog
        open={tagOpen}
        error={tagError}
        pending={pending}
        onSubmit={submitTag}
        onClose={() => setTagOpen(false)}
      />

      <NameDialog
        key={naming.item?.id ?? "new"}
        open={nameOpen}
        item={naming.item}
        error={nameError}
        pending={pending}
        onSubmit={submitName}
        onClose={() => setNameOpen(false)}
      />

      <Dialog.Root
        open={confirmOpen}
        onOpenChange={(o) => !o && !pending && setConfirmOpen(false)}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={DIALOG_BACKDROP} />
          <Dialog.Popup className={DIALOG_POPUP}>
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold text-balance">
                {confirm?.ids.length
                  ? `Delete ${confirm.label} forever?`
                  : "Empty the trash?"}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                {confirm?.ids.length
                  ? "It's removed for good, along with anything inside it. You can't undo this."
                  : "Everything in the trash is removed for good. You can't undo this."}
              </Dialog.Description>
            </div>
            <div className="flex justify-end gap-2">
              <Dialog.Close
                disabled={pending}
                render={<Button variant="outline" />}
              >
                Cancel
              </Dialog.Close>
              <SubmitButton
                type="button"
                variant="destructive"
                pending={pending}
                onClick={confirmDelete}
              >
                {confirm?.ids.length ? "Delete forever" : "Empty trash"}
              </SubmitButton>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function TagDialog({
  open,
  error,
  pending,
  onSubmit,
  onClose,
}: {
  open: boolean
  error: string | null
  pending: boolean
  onSubmit: (name: string, color: TagColor) => void
  onClose: () => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">
              New tag
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              Tags are yours alone. Nobody else sees them, even on shared files.
            </Dialog.Description>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              onSubmit(String(f.get("name")), f.get("color") as TagColor)
            }}
          >
            <div className="grid gap-2">
              <Input
                name="name"
                aria-label="Tag name"
                placeholder="Tag name"
                autoComplete="off"
                maxLength={40}
                aria-invalid={Boolean(error)}
              />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">Color</legend>
              {(Object.keys(TAG_DOT) as TagColor[]).map((c) => (
                <label
                  key={c}
                  className="cursor-pointer rounded-full p-0.5 has-checked:ring-2 has-checked:ring-foreground has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
                >
                  <input
                    type="radio"
                    name="color"
                    value={c}
                    defaultChecked={c === "blue"}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={cn("block size-6 rounded-full", TAG_DOT[c])}
                  />
                  <span className="sr-only">{c}</span>
                </label>
              ))}
            </fieldset>
            <div className="flex justify-end gap-2">
              <Dialog.Close
                disabled={pending}
                render={<Button variant="outline" />}
              >
                Cancel
              </Dialog.Close>
              <SubmitButton pending={pending}>Create tag</SubmitButton>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Pill for a filter or the sort order. A filter that's on shows its value with
// a teal tint and an inline clear button.
function Pick({
  label,
  icon: ChipIcon,
  value,
  options,
  onChange,
  anyLabel,
  display,
  extra,
}: {
  label: string
  icon: Icon
  value: string
  options: { value: string; label: string; icon?: React.ReactNode }[]
  onChange: (v: string) => void
  anyLabel?: string
  display?: React.ReactNode
  extra?: React.ReactNode
}) {
  const current = options.find((o) => o.value === value)
  const active = Boolean(anyLabel && current)
  return (
    <div
      className={cn(
        "flex h-8 items-center rounded-full border text-sm transition-colors",
        active
          ? "border-brand/40 bg-brand/10"
          : "border-input bg-input/20 hover:bg-input/40"
      )}
    >
      <Menu.Root>
        <Menu.Trigger
          aria-label={
            display
              ? `${label}: ${current?.label}`
              : active
                ? `${label}: ${current?.label}`
                : undefined
          }
          className={cn(
            "flex h-full items-center gap-1.5 rounded-full pl-3 font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
            active ? "pr-1.5" : "pr-2.5"
          )}
        >
          {active && current?.icon ? (
            current.icon
          ) : (
            <ChipIcon
              className={active ? "text-brand" : "text-muted-foreground"}
            />
          )}
          {display ?? (active ? current!.label : label)}
          {!active && (
            <CaretDownIcon className="size-3! text-muted-foreground" />
          )}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="start" sideOffset={6}>
            <Menu.Popup className={`min-w-52 ${MENU_POPUP}`}>
              <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
                {label}
              </div>
              <Menu.RadioGroup value={value} onValueChange={onChange}>
                {anyLabel && (
                  <PickItem value="">
                    <ChipIcon />
                    {anyLabel}
                  </PickItem>
                )}
                {options.map((o) => (
                  <PickItem key={o.value} value={o.value}>
                    {o.icon}
                    {o.label}
                  </PickItem>
                ))}
              </Menu.RadioGroup>
              {extra}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {active && (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()} filter`}
          onClick={() => onChange("")}
          className="mr-1 grid size-6 place-items-center rounded-full text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}

// Rising bars standing in for a size range, 1 (small) to 4 (huge).
function Bars({ n }: { n: number }) {
  return (
    <span aria-hidden className="flex h-4 w-4 items-end justify-center gap-px">
      {["h-1", "h-1.5", "h-2.5", "h-3.5"].map((h, i) => (
        <span
          key={h}
          className={cn(
            "w-[3px] rounded-[1px]",
            h,
            i < n ? "bg-foreground/80" : "bg-foreground/20"
          )}
        />
      ))}
    </span>
  )
}

function PickItem({
  value,
  children,
}: {
  value: string
  children: React.ReactNode
}) {
  return (
    <Menu.RadioItem
      value={value}
      closeOnClick
      className={cn(MENU_ITEM, "relative pr-8")}
    >
      {children}
      <Menu.RadioItemIndicator className="absolute right-2">
        <CheckIcon className="size-4" />
      </Menu.RadioItemIndicator>
    </Menu.RadioItem>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ml-auto font-sans text-xs text-muted-foreground">
      {children}
    </kbd>
  )
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string; icon: Icon }[]
  onChange: (v: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex rounded-lg bg-muted p-[3px]"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.value)}
          className="grid h-7 w-8 place-items-center rounded-md border border-transparent text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:border-input aria-pressed:bg-input/30 aria-pressed:text-foreground [&_svg]:size-4"
        >
          <o.icon />
        </button>
      ))}
    </div>
  )
}

// Name entry for rename and new folder. Selects a file's name without its extension.
function NameDialog({
  open,
  item,
  error,
  pending,
  onSubmit,
  onClose,
}: {
  open: boolean
  item: Item | null
  error: string | null
  pending: boolean
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const initial = item?.name ?? "Untitled folder"
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup
          className={DIALOG_POPUP}
          initialFocus={() => {
            const el = document.getElementById(
              "item-name"
            ) as HTMLInputElement | null
            const dot = initial.lastIndexOf(".")
            el?.setSelectionRange(
              0,
              item?.kind === "file" && dot > 0 ? dot : initial.length
            )
            return el
          }}
        >
          <Dialog.Title className="text-base font-semibold">
            {item ? "Rename" : "New folder"}
          </Dialog.Title>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              onSubmit(String(new FormData(e.currentTarget).get("name")))
            }}
          >
            <div className="grid gap-2">
              <Input
                id="item-name"
                name="name"
                aria-label="Name"
                defaultValue={initial}
                autoComplete="off"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "item-name-error" : undefined}
              />
              {error && (
                <p
                  id="item-name-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {error}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Dialog.Close
                disabled={pending}
                render={<Button variant="outline" />}
              >
                Cancel
              </Dialog.Close>
              <SubmitButton pending={pending}>
                {item ? "Save" : "Create"}
              </SubmitButton>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
