import type { Item, Role, Tag, Version, VersionsResponse } from "@nimbus/shared/api"
import { OFFICE_EXT, TYPE_KEYS, formatBytes, previewKind } from "@nimbus/shared/file-rules"
import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import {
  ArrowBendUpRight,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowLeft,
  ArrowSquareOut,
  ArrowUp,
  ArrowsClockwise,
  CaretRight,
  Check,
  DotsThreeVertical,
  DownloadSimple,
  FileText,
  FilmStrip,
  FolderOpen,
  FolderPlus,
  Info,
  Minus,
  PencilSimple,
  Plus,
  SelectionAll,
  Star,
  Tag as TagIcon,
  Trash,
  X,
} from "phosphor-react-native"
import { useState, type ReactNode } from "react"
import { ActivityIndicator, Pressable, Switch, View } from "react-native"

import { ConfirmDialog, PromptDialog } from "@/components/dialog"
import { FILE_TYPES, FileIcon } from "@/components/file-icon"
import { useOffice } from "@/components/preview-pages"
import { Sheet, SheetDivider, SheetRow, useDismiss } from "@/components/sheet"
import { TagDialog } from "@/components/tag-dialog"
import { Button, Text } from "@/components/ui"
import { editable, label, roleOf, useApi, useDetails, useFileActions, useFolders, useTags, type FileSheet, type Filters } from "@/lib/files"
import { usePrefs, type Prefs } from "@/lib/prefs"
import { openPreview } from "@/lib/preview-session"
import { useTransfers } from "@/lib/transfers"
import type { Tiles } from "@/lib/rows"
import { c } from "@/lib/theme"

// Same values as the API's query; the Browser's chips show these (tag looks up its own name).
export const FILTER_LABELS: Record<"type" | "modified" | "size", Record<string, string>> = {
  type: Object.fromEntries(TYPE_KEYS.map((k) => [k, FILE_TYPES[k].label])),
  modified: { today: "Today", week: "Last 7 days", month: "Last 30 days", year: "This year" },
  size: { small: "Under 1 MB", medium: "1 MB to 100 MB", large: "100 MB to 1 GB", huge: "Over 1 GB" },
}

const ICON = 24
const mute = c.mutedForeground
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const full = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })

type Dialog =
  | { kind: "rename"; item: Item }
  | { kind: "forever"; items: Item[] }
  | { kind: "folder"; parentId: string | null }
  | { kind: "tag"; items: Item[] }

type Props = {
  sheet: FileSheet | null
  onChange: (next: FileSheet | null) => void
  role: Role
  trash: boolean
  tags: Tag[]
  filters: Filters
  onFilters: (f: Filters) => void
  tagFilter: boolean
  sortable: boolean
  onOpen: (item: Item) => void
  onSelectAll?: () => void
  onDone?: () => void
  // From the previewer: what to do when the file on screen goes, and the frame on screen.
  onTrashed?: (items: Item[]) => void
  onUseFrame?: () => void
  // The older version on screen, which Download and Open with then act on.
  previewing?: Version
}

export function FileSheets(props: Props) {
  const { sheet, onDone } = props
  const actions = useFileActions()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const close = () => setDialog(null)

  // End of the extension, so a rename can keep ".pdf" untouched.
  const selectEnd = (item: Item) => {
    const dot = item.name.lastIndexOf(".")
    return item.kind === "file" && dot > 0 ? dot : item.name.length
  }

  return (
    <>
      {sheet && <SheetFor key={sheet.kind} {...props} sheet={sheet} ask={setDialog} />}
      {dialog?.kind === "rename" && (
        <PromptDialog
          title="Rename"
          label="Name"
          confirm="Rename"
          initial={dialog.item.name}
          selectEnd={selectEnd(dialog.item)}
          onClose={close}
          onSubmit={async (name) => {
            const problem = await actions.rename(dialog.item, name)
            if (!problem) onDone?.()
            return problem
          }}
        />
      )}
      {dialog?.kind === "forever" && (
        <ConfirmDialog
          title="Delete forever?"
          body={`${label(dialog.items)} will be deleted forever. This can't be undone.`}
          confirm="Delete forever"
          onClose={close}
          onConfirm={() => {
            actions.remove(dialog.items)
            onDone?.()
          }}
        />
      )}
      {dialog?.kind === "folder" && (
        <PromptDialog
          title="New folder"
          label="Folder name"
          confirm="Create"
          onClose={close}
          onSubmit={(name) => actions.newFolder(dialog.parentId, name)}
        />
      )}
      {dialog?.kind === "tag" && <TagDialog applyTo={dialog.items.map((i) => i.id)} onClose={close} />}
    </>
  )
}

function SheetFor(props: Props & { sheet: FileSheet; ask: (d: Dialog) => void }) {
  const { sheet, onChange } = props
  const onClose = () => onChange(null)
  switch (sheet.kind) {
    case "actions":
      return <ActionsSheet {...props} items={sheet.items} onClose={onClose} />
    case "details":
      return <DetailsSheet {...props} item={sheet.item} onClose={onClose} />
    case "tags":
      return <TagsSheet {...props} items={sheet.items} onClose={onClose} />
    case "move":
      return <MoveSheet {...props} items={sheet.items} onClose={onClose} />
    case "new":
      return <NewSheet {...props} parentId={sheet.parentId} onClose={onClose} />
    case "filter":
      return <FilterSheet {...props} filter={sheet.filter} onClose={onClose} />
    case "sort":
      return <SortSheet {...props} onClose={onClose} />
  }
}

// ---- Shared pieces ----

function Header({ icon, title, caption, trailing }: { icon?: ReactNode; title: string; caption?: string; trailing?: ReactNode }) {
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.border, marginBottom: 4 }}>
      <View style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 20, paddingBottom: 8 }}>
        {icon}
        <View style={{ flex: 1 }}>
          <Text variant="titleSmall" numberOfLines={1}>
            {title}
          </Text>
          {caption && (
            <Text variant="caption" color={mute} numberOfLines={1}>
              {caption}
            </Text>
          )}
        </View>
        {trailing}
      </View>
    </View>
  )
}

const Dot = ({ color, size = 10 }: { color: string; size?: number }) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
)

const Empty = ({ children }: { children: string }) => (
  <View style={{ paddingHorizontal: 20, paddingVertical: 24 }}>
    <Text color={mute}>{children}</Text>
  </View>
)

const itemsHeader = (items: Item[], trailing?: ReactNode) =>
  items.length === 1 ? (
    <Header
      icon={<FileIcon item={items[0]} />}
      title={items[0].name}
      caption={[day(items[0].updatedAt), items[0].kind === "file" ? formatBytes(items[0].size) : null].filter(Boolean).join(" · ")}
      trailing={trailing}
    />
  ) : (
    <Header title={`${items.length} items`} trailing={trailing} />
  )

// ---- Actions ----

// Only asks the server about Collabora for files it could open.
function CollaboraRow({ item, onClose, icon }: { item: Item; onClose: () => void; icon: ReactNode }) {
  const office = useOffice(item)
  if (!office.data?.office) return null
  return (
    <SheetRow
      label="Open in Collabora"
      icon={icon}
      onPress={() => {
        onClose()
        router.push({ pathname: "/collabora", params: { id: item.id } })
      }}
    />
  )
}

function ActionsSheet({ items, role, trash, onChange, onClose, onOpen, onSelectAll, onDone, onTrashed, onUseFrame, previewing, ask }: Props & { items: Item[]; onClose: () => void; ask: (d: Dialog) => void }) {
  const actions = useFileActions()
  const transfers = useTransfers()
  const one = items.length === 1 ? items[0] : null
  const file = one?.kind === "file" ? one : null
  const done = () => onDone?.()
  const ic = (I: typeof Info) => <I size={ICON} color={mute} />

  if (trash)
    return (
      <Sheet onClose={onClose} header={itemsHeader(items)}>
        {one && <SheetRow label="Details" icon={ic(Info)} onPress={() => onChange({ kind: "details", item: one })} />}
        <SheetRow
          label="Restore"
          icon={ic(ArrowCounterClockwise)}
          onPress={() => {
            actions.restore(items)
            done()
          }}
        />
        <SheetDivider />
        <SheetRow label="Delete forever" icon={<Trash size={ICON} color={c.destructive} />} danger onPress={() => ask({ kind: "forever", items })} />
      </Sheet>
    )

  // Changes apply to the whole file, so looking at an older version offers only what's about that version.
  if (previewing && file)
    return (
      <Sheet onClose={onClose} header={itemsHeader([{ ...file, size: previewing.size, updatedAt: previewing.createdAt }])}>
        <SheetRow
          label="Download"
          icon={ic(DownloadSimple)}
          onPress={() => {
            transfers.download([file], previewing)
            onClose()
          }}
        />
        <SheetRow
          label="Open with"
          icon={ic(ArrowSquareOut)}
          onPress={() => {
            transfers.openWith(file, previewing)
            onClose()
          }}
        />
        <SheetRow label="Details" icon={ic(Info)} onPress={() => onChange({ kind: "details", item: file })} />
      </Sheet>
    )

  const edit = editable(items, role)
  const starred = items.every((i) => i.starred)
  return (
    <Sheet onClose={onClose} header={itemsHeader(items)}>
      {one?.kind === "folder" && <SheetRow label="Open" icon={ic(FolderOpen)} onPress={() => onOpen(one)} />}
      {onSelectAll && <SheetRow label="Select all" icon={ic(SelectionAll)} onPress={onSelectAll} />}
      <SheetRow
        label={file ? "Download" : "Download as ZIP"}
        icon={ic(DownloadSimple)}
        onPress={() => {
          transfers.download(items)
          done()
          onClose()
        }}
      />
      {file && (
        <SheetRow
          label="Open with"
          icon={ic(ArrowSquareOut)}
          onPress={() => {
            transfers.openWith(file)
            onClose()
          }}
        />
      )}
      {file && OFFICE_EXT.test(file.name) && <CollaboraRow item={file} onClose={onClose} icon={ic(FileText)} />}
      {one && edit && <SheetRow label="Rename" icon={ic(PencilSimple)} onPress={() => ask({ kind: "rename", item: one })} />}
      {edit && <SheetRow label="Move" icon={ic(ArrowBendUpRight)} onPress={() => onChange({ kind: "move", items })} />}
      <SheetRow
        label={starred ? "Remove from starred" : "Add to starred"}
        icon={<Star size={ICON} color={mute} weight={starred ? "fill" : "regular"} />}
        onPress={() => {
          actions.star(items)
          done()
        }}
      />
      {one && roleOf(one, role) !== "owner" && !one.shortcut && (
        <SheetRow
          label="Add shortcut to My files"
          icon={ic(ArrowSquareOut)}
          onPress={() => {
            actions.addShortcut(one)
            done()
          }}
        />
      )}
      {one?.shortcut && (
        <SheetRow
          label="Remove shortcut"
          icon={ic(X)}
          onPress={() => {
            actions.removeShortcut(one)
            done()
          }}
        />
      )}
      <SheetRow label="Tags" icon={ic(TagIcon)} onPress={() => onChange({ kind: "tags", items })} />
      {file && edit && onUseFrame && (
        <SheetRow
          label="Use this frame as thumbnail"
          icon={ic(FilmStrip)}
          onPress={() => {
            onUseFrame()
            onClose()
          }}
        />
      )}
      {file && edit && !!file.thumb && (
        <SheetRow
          label="Reset thumbnail"
          icon={ic(ArrowsClockwise)}
          onPress={() => {
            actions.resetThumb(file, previewKind(file.mime, file.name) === "video")
            onClose()
          }}
        />
      )}
      {one && (
        <>
          <SheetDivider />
          <SheetRow label="Details" icon={ic(Info)} onPress={() => onChange({ kind: "details", item: one })} />
        </>
      )}
      {edit && (
        <>
          <SheetDivider />
          <SheetRow
            label="Move to trash"
            icon={<Trash size={ICON} color={c.destructive} />}
            danger
            onPress={() => {
              actions.trash(items)
              done()
              onTrashed?.(items)
            }}
          />
        </>
      )}
    </Sheet>
  )
}

// ---- Details ----

// Read-only here; making one current, renaming and deleting come with the Versions dialog in Phase 4.
function OlderVersions({ item, role, onClose }: { item: Item; role: Role; onClose: () => void }) {
  const api = useApi()
  const q = useQuery({
    queryKey: [api.id, "versions", item.id],
    queryFn: () => api.get<VersionsResponse>(`/items/${item.id}/versions`),
  })
  const older = (q.data?.versions ?? []).filter((v) => v.id !== item.version)
  if (!older.length) return null
  return (
    <View style={{ paddingTop: 16 }}>
      <Text variant="label" color={mute} style={{ paddingHorizontal: 20, paddingBottom: 4 }}>
        Older versions
      </Text>
      {older.map((v) => (
        <Pressable
          key={v.id}
          onPress={() => {
            onClose()
            openPreview({ items: [item], index: 0, role, version: v })
          }}
          android_ripple={{ color: c.ripple }}
          accessibilityRole="button"
          accessibilityLabel={`Open version ${v.number}, ${day(v.createdAt)}`}
          style={{ minHeight: 56, paddingHorizontal: 20, paddingVertical: 8, justifyContent: "center" }}
        >
          <Text>v{v.number} · {day(v.createdAt)}</Text>
          <Text variant="caption" color={mute} numberOfLines={1} style={{ fontVariant: ["tabular-nums"] }}>
            {[formatBytes(v.size), v.uploadedBy, v.note].filter(Boolean).join(" · ")}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

function DetailsSheet({ item, role, trash, tags, onChange, onClose }: Props & { item: Item; onClose: () => void }) {
  const q = useDetails(item.id)
  const actions = useFileActions()
  const mine = useTags().data ?? tags
  const [applied, setApplied] = useState(item.tags)
  const d = q.data?.details

  const value = (v: ReactNode) =>
    q.isError ? (
      <Text color={c.destructive}>{q.error instanceof Error ? q.error.message : "Couldn't load this."}</Text>
    ) : v === undefined || v === null || v === false ? (
      <ActivityIndicator size="small" color={mute} accessibilityLabel="Loading" style={{ alignSelf: "flex-start" }} />
    ) : (
      <Text>{v}</Text>
    )

  const rows: [string, ReactNode][] = [
    ["Type", <Text key="t">{item.kind === "folder" ? "Folder" : (item.mime ?? "Unknown")}</Text>],
    item.kind === "file"
      ? [
          "Size",
          <Text key="s" style={{ fontVariant: ["tabular-nums"] }}>
            {formatBytes(item.size)} <Text color={mute}>({item.size.toLocaleString()} bytes)</Text>
          </Text>,
        ]
      : [
          "Contains",
          value(d?.contents && `${plural(d.contents.folders, "folder")}, ${plural(d.contents.files, "file")} · ${formatBytes(d.contents.bytes)}`),
        ],
    ["Location", value(d && (d.location ? d.location.join(" / ") : "Not shown"))],
    ["Owner", value(d?.owner)],
    ["Created", value(d && full(d.createdAt))],
    ["Modified", <Text key="m">{full(item.updatedAt)}</Text>],
    ...(item.trashedAt ? [["Trashed", <Text key="tr">{full(item.trashedAt)}</Text>] as [string, ReactNode]] : []),
    ["Sharing", value(d && (d.shares === null ? "Shared with you" : d.shares ? `Shared ${plural(d.shares, "time")}` : "Only you"))],
  ]

  const remove = (tag: Tag) => {
    setApplied((a) => a.filter((id) => id !== tag.id))
    actions.applyTag([item], tag.id, false)
  }

  return (
    <Sheet
      onClose={onClose}
      header={itemsHeader(
        [item],
        !trash && <MoreButton onPress={() => onChange({ kind: "actions", items: [item] })} />
      )}
    >
      {rows.map(([name, v]) => (
        <View key={name} style={{ minHeight: 48, paddingHorizontal: 20, paddingVertical: 8, gap: 2 }}>
          <Text variant="caption" color={mute}>
            {name}
          </Text>
          {v}
        </View>
      ))}
      {!trash && item.kind === "file" && <OlderVersions item={item} role={role} onClose={onClose} />}
      {!trash && (
        <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 8 }}>
          <Text variant="caption" color={mute}>
            Tags
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {mine
              .filter((t) => applied.includes(t.id))
              .map((t) => (
                <View
                  key={t.id}
                  style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, borderRadius: 16, borderWidth: 1, borderColor: c.input }}
                >
                  <Dot color={c.tag[t.color]} size={8} />
                  <Text variant="bodySmall">{t.name}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove tag ${t.name}`}
                    android_ripple={{ color: c.ripple, borderless: true, radius: 24 }}
                    onPress={() => remove(t)}
                    // 48dp target around a small chip: the hit area spills past it.
                    style={{ width: 48, height: 48, marginVertical: -8, marginLeft: -8, alignItems: "center", justifyContent: "center" }}
                  >
                    <X size={16} color={mute} />
                  </Pressable>
                </View>
              ))}
            <Button variant="outlined" label="Add tag" icon={<Plus size={18} color={c.foreground} />} onPress={() => onChange({ kind: "tags", items: [{ ...item, tags: applied }] })} />
          </View>
        </View>
      )}
    </Sheet>
  )
}

function MoreButton({ onPress }: { onPress: () => void }) {
  const dismiss = useDismiss()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="More actions"
      android_ripple={{ color: c.ripple, borderless: true, radius: 24 }}
      onPress={() => dismiss(onPress)}
      style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
    >
      <DotsThreeVertical size={ICON} color={mute} weight="bold" />
    </Pressable>
  )
}

// ---- Tags ----

function TagsSheet({ items, tags, onClose, ask }: Props & { items: Item[]; onClose: () => void; ask: (d: Dialog) => void }) {
  const actions = useFileActions()
  const mine = useTags().data ?? tags
  // Item id -> tags on it, so the checks answer at once; the server catches up behind.
  const [on, setOn] = useState(() => new Map(items.map((i) => [i.id, new Set(i.tags)])))
  const count = (id: string) => items.filter((i) => on.get(i.id)?.has(id)).length

  const toggle = (tagId: string) => {
    const turnOn = count(tagId) < items.length
    setOn((m) => {
      const next = new Map(m)
      for (const i of items) {
        const s = new Set(next.get(i.id))
        if (turnOn) s.add(tagId)
        else s.delete(tagId)
        next.set(i.id, s)
      }
      return next
    })
    actions.applyTag(items, tagId, turnOn)
  }

  return (
    <Sheet onClose={onClose} header={<Header title="Tags" />}>
      {mine.length === 0 && <Empty>No tags yet</Empty>}
      {mine.map((t) => {
        const n = count(t.id)
        return (
          <SheetRow
            key={t.id}
            stay
            label={t.name}
            icon={<Dot color={c.tag[t.color]} />}
            selected={n === items.length}
            trailing={n === items.length ? <Check size={ICON} color={c.brand} /> : n > 0 ? <Minus size={ICON} color={mute} /> : undefined}
            onPress={() => toggle(t.id)}
          />
        )
      })}
      <SheetRow label="New tag" icon={<Plus size={ICON} color={mute} />} onPress={() => ask({ kind: "tag", items })} />
    </Sheet>
  )
}

// ---- Move ----

type Place = { id: string | null; name: string }
const ROOT: Place = { id: null, name: "My files" }

function MoveSheet({ items, onClose, onDone }: Props & { items: Item[]; onClose: () => void }) {
  const actions = useFileActions()
  const [stack, setStack] = useState<Place[]>([ROOT])
  const here = stack[stack.length - 1]
  const q = useFolders(here.id)
  const moving = items.map((i) => i.id)

  return (
    <Sheet
      tall
      onClose={onClose}
      header={
        <Header
          title={here.name}
          caption={`Move ${plural(items.length, "item")}`}
          icon={
            stack.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                android_ripple={{ color: c.ripple, borderless: true, radius: 24 }}
                onPress={() => setStack((s) => s.slice(0, -1))}
                style={{ width: 48, height: 48, marginLeft: -12, marginRight: -12, alignItems: "center", justifyContent: "center" }}
              >
                <ArrowLeft size={ICON} color={c.foreground} />
              </Pressable>
            ) : undefined
          }
        />
      }
      footer={<MoveFooter onMove={() => { actions.move(items, here.id, here.name); onDone?.() }} />}
    >
      {q.isPending ? (
        <ActivityIndicator color={mute} accessibilityLabel="Loading" style={{ margin: 24 }} />
      ) : q.isError ? (
        <Empty>{q.error instanceof Error ? q.error.message : "Couldn't load folders."}</Empty>
      ) : q.data.folders.length === 0 ? (
        <Empty>No folders here</Empty>
      ) : (
        q.data.folders.map((f) => {
          const self = moving.includes(f.id)
          return (
            // A folder can't go inside itself.
            <View key={f.id} style={{ opacity: self ? 0.4 : 1 }} pointerEvents={self ? "none" : "auto"} accessibilityState={{ disabled: self }}>
              <SheetRow
                stay
                label={f.name}
                icon={<FileIcon item={{ kind: "folder", mime: null, name: f.name }} />}
                trailing={<CaretRight size={20} color={mute} />}
                onPress={() => setStack((s) => [...s, f])}
              />
            </View>
          )
        })
      )}
    </Sheet>
  )
}

function MoveFooter({ onMove }: { onMove: () => void }) {
  const dismiss = useDismiss()
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border }}>
      <Button label="Move here" onPress={() => dismiss(onMove)} />
    </View>
  )
}

// ---- New ----

function NewSheet({ parentId, onClose, ask }: Props & { parentId: string | null; onClose: () => void; ask: (d: Dialog) => void }) {
  return (
    <Sheet onClose={onClose} header={<Header title="New" />}>
      <SheetRow label="New folder" icon={<FolderPlus size={ICON} color={mute} />} onPress={() => ask({ kind: "folder", parentId })} />
    </Sheet>
  )
}

// ---- Filter ----

type Option = { value: string; label: string; icon?: ReactNode }

function FilterSheet({ filter, filters, onFilters, onClose, tags }: Props & { filter: "type" | "modified" | "size" | "tag"; onClose: () => void }) {
  const mine = useTags().data ?? tags
  const options: Option[] =
    filter === "tag"
      ? mine.map((t) => ({ value: t.id, label: t.name, icon: <Dot color={c.tag[t.color]} /> }))
      : Object.entries(FILTER_LABELS[filter]).map(([value, text]) => ({
          value,
          label: text,
          icon:
            filter === "type" ? (
              (() => {
                const t = FILE_TYPES[value as keyof typeof FILE_TYPES]
                return <t.icon size={ICON} color={t.color} weight={value === "folder" ? "fill" : "regular"} />
              })()
            ) : undefined,
        }))
  const current = filters[filter]
  const set = (value: string | undefined) => onFilters({ ...filters, [filter]: value })
  const title = { type: "Type", modified: "Modified", size: "Size", tag: "Tags" }[filter]

  return (
    <Sheet onClose={onClose} header={<Header title={title} />}>
      {current && <SheetRow label="Any" onPress={() => set(undefined)} />}
      {filter === "tag" && options.length === 0 && <Empty>No tags yet</Empty>}
      {options.map((o) => (
        <SheetRow
          key={o.value}
          label={o.label}
          icon={o.icon}
          selected={o.value === current}
          trailing={o.value === current ? <Check size={ICON} color={c.brand} /> : undefined}
          onPress={() => set(o.value === current ? undefined : o.value)}
        />
      ))}
    </Sheet>
  )
}

// ---- Sort and view ----

const SORTS: { key: Prefs["sort"]; label: string; first: Prefs["order"] }[] = [
  { key: "name", label: "Name", first: "asc" },
  { key: "date", label: "Modified", first: "desc" },
  { key: "size", label: "Size", first: "desc" },
]
const TILES: { key: Tiles; label: string }[] = [
  { key: "small", label: "Small" },
  { key: "medium", label: "Medium" },
  { key: "large", label: "Large" },
]

function SortSheet({ sortable, onClose }: Props & { onClose: () => void }) {
  const api = useApi()
  const [prefs, set] = usePrefs(api.id)
  return (
    <Sheet onClose={onClose} header={<Header title="Sort and view" />}>
      {sortable && (
        <>
          {SORTS.map((s) => {
            const now = prefs.sort === s.key
            const Arrow = prefs.order === "asc" ? ArrowUp : ArrowDown
            return (
              <SheetRow
                key={s.key}
                label={s.label}
                selected={now}
                trailing={now ? <Arrow size={ICON} color={c.brand} /> : undefined}
                onPress={() => set(now ? { order: prefs.order === "asc" ? "desc" : "asc" } : { sort: s.key, order: s.first })}
              />
            )
          })}
          <SheetDivider />
        </>
      )}
      {prefs.layout === "grid" && (
      <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 8 }}>
        <Text variant="label">Tile size</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {TILES.map((t) => {
            const now = prefs.tiles === t.key
            return (
              <Pressable
                key={t.key}
                accessibilityRole="button"
                accessibilityState={{ selected: now }}
                android_ripple={{ color: c.ripple }}
                onPress={() => set({ tiles: t.key })}
                style={{
                  flex: 1,
                  minHeight: 48,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 24,
                  borderWidth: 1,
                  borderColor: now ? c.brand : c.input,
                  backgroundColor: now ? c.brandWash : "transparent",
                }}
              >
                <Text variant="label" color={now ? c.brand : c.foreground}>
                  {t.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>
      )}
      <SheetRow
        stay
        label="Compact"
        trailing={
          <Switch
            value={prefs.compact}
            onValueChange={(v) => set({ compact: v })}
            accessibilityLabel="Compact"
            trackColor={{ true: c.brand, false: c.mutedStrong }}
            thumbColor={c.foreground}
          />
        }
        onPress={() => set({ compact: !prefs.compact })}
      />
    </Sheet>
  )
}
