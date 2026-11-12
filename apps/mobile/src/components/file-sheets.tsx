import type { Item, Role, Tag, Version } from "@nimbus/shared/api"
import { OFFICE_EXT, TYPE_KEYS, formatBytes, previewKind } from "@nimbus/shared/file-rules"
import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import * as ImagePicker from "expo-image-picker"
import {
  ArrowBendUpRight,
  ArrowCircleDown,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowLeft,
  ArrowSquareOut,
  ArrowUp,
  ArrowsClockwise,
  Camera as CameraIcon,
  CaretRight,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  DotsThreeVertical,
  DownloadSimple,
  FileText,
  FilmStrip,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  ImagesSquare,
  Info,
  Link as LinkIcon,
  Lock,
  NotePencil,
  Minus,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Scan,
  SelectionAll,
  ShareNetwork,
  Star,
  Tag as TagIcon,
  Trash,
  UploadSimple,
  VideoCamera,
  X,
  type Icon,
} from "phosphor-react-native"
import { createElement, useState, type ReactNode } from "react"
import { ActivityIndicator, Pressable, Switch, View } from "react-native"

import { Avatar } from "@/components/avatar"
import { ConfirmDialog, PromptDialog } from "@/components/dialog"
import { FILE_TYPES, FileIcon } from "@/components/file-icon"
import { useOffice } from "@/components/preview-pages"
import { CapDialog } from "@/components/offline-ui"
import { SwitchRow } from "@/components/page"
import { canEdit } from "@/lib/editor-rules"
import { ActivityList } from "@/components/activity-list"
import { Sheet, SheetDivider, SheetRow, useDismiss } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { TagDialog } from "@/components/tag-dialog"
import { VaultPickSheet, canVault } from "@/components/vault-sheets"
import { sendWithTransfer, useSent } from "@/lib/sent"
import { useUploader } from "@/components/uploader"
import { Button, Text } from "@/components/ui"
import { whilePicking } from "@/lib/picking"
import { saveToDevice, syncAvailable } from "@/lib/folder-sync"
import { editable, label, roleOf, shareable, useApi, useDetails, useFileActions, useFolders, useLinks, useShareState, useTags, useVersions, type FileSheet, type Filters } from "@/lib/files"
import { errorText } from "@/lib/api"
import { native } from "@/lib/native"
import { useOfflineActions, type CapAsk } from "@/lib/offline-hooks"
import { usePrefs, type Prefs } from "@/lib/prefs"
import { imageToWebp } from "@/lib/thumbs"
import type { Entry } from "@/lib/upload-plan"
import { pick } from "@/lib/uploads"
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
  | { kind: "cap"; ask: CapAsk }

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
      {dialog?.kind === "cap" && <CapDialog ask={dialog.ask} onClose={close} />}
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
    case "vault":
      return <VaultPickSheet title={`Move ${plural(sheet.items.length, "item")} to a vault`} intake={{ items: sheet.items }} onClose={onClose} />
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
  const api = useApi()
  const snack = useSnack()
  const links = useLinks()
  const sent = useSent()
  const offline = useOfflineActions()
  const one = items.length === 1 ? items[0] : null
  const file = one?.kind === "file" ? one : null
  const done = () => onDone?.()
  const kept = items.every((i) => offline.snap.covered.has(i.id))
  const keptVia = one && offline.snap.covered.has(one.id) && offline.snap.rootOf.get(one.id) !== one.id ? offline.snap.roots.find((r) => r.id === offline.snap.rootOf.get(one.id)) : undefined
  const toggleOffline = async () => {
    const over = await offline.set(items, !kept)
    if (over) ask({ kind: "cap", ask: over })
    else done()
  }
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
        <SheetRow label="Delete forever" needsNet icon={<Trash size={ICON} color={c.destructive} />} danger onPress={() => ask({ kind: "forever", items })} />
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
      {one && shareable(one, role) && (
        <>
          <SheetRow
            label="Share"
            needsNet
            icon={ic(ShareNetwork)}
            onPress={() => {
              done()
              router.push({ pathname: "/share/[id]", params: { id: one.id, name: one.name } })
            }}
          />
          <SheetRow
            label="Copy link"
            needsNet
            icon={ic(LinkIcon)}
            onPress={() => {
              done()
              links.copyFor(one)
            }}
          />
          {one.kind === "folder" && (
            <SheetRow
              label="Request files"
              needsNet
              icon={ic(UploadSimple)}
              onPress={() => {
                done()
                router.push({ pathname: "/share/[id]", params: { id: one.id, name: one.name, request: "1" } })
              }}
            />
          )}
        </>
      )}
      <SheetRow
        label={file ? "Download" : "Download as ZIP"}
        needsNet
        icon={ic(DownloadSimple)}
        onPress={() => {
          transfers.download(items)
          done()
          onClose()
        }}
      />
      {syncAvailable && (
        <SheetRow
          label="Save to device…"
          detail="An SD card, USB drive or any folder"
          needsNet
          icon={ic(DownloadSimple)}
          onPress={async () => {
            onClose()
            if (await saveToDevice(api.id, items)) snack({ text: "Saving in the background. You'll get a notification when it's done." })
          }}
        />
      )}
      {file && (
        <SheetRow
          label="Open with"
          needsNet={!offline.snap.files.has(file.id)}
          icon={ic(ArrowSquareOut)}
          onPress={() => {
            transfers.openWith(file)
            onClose()
          }}
        />
      )}
      <SheetRow
        label={kept ? "Available offline" : "Make available offline"}
        detail={keptVia ? `Kept by “${keptVia.name}”` : undefined}
        icon={<ArrowCircleDown size={ICON} color={kept ? c.brand : mute} weight={kept ? "fill" : "regular"} />}
        trailing={kept ? <CheckCircle size={ICON} color={c.brand} weight="fill" /> : undefined}
        onPress={toggleOffline}
      />
      {file && edit && canEdit(file.name, file.mime) && (
        <SheetRow
          label="Edit"
          icon={ic(NotePencil)}
          onPress={() => {
            onClose()
            router.push({ pathname: "/edit", params: { id: file.id } })
          }}
        />
      )}
      {file && OFFICE_EXT.test(file.name) && <CollaboraRow item={file} onClose={onClose} icon={ic(FileText)} />}
      {one && edit && <SheetRow label="Rename" icon={ic(PencilSimple)} onPress={() => ask({ kind: "rename", item: one })} />}
      {sent.data?.options.enabled !== false && !items.some((i) => i.shortcut) && (
        <SheetRow
          label="Send with Transfer"
          needsNet
          icon={ic(PaperPlaneTilt)}
          onPress={() => {
            done()
            sendWithTransfer(items.map((i) => ({ id: i.id, name: i.name, kind: i.kind, mime: i.mime, size: i.size })))
          }}
        />
      )}
      {edit && <SheetRow label="Move" icon={ic(ArrowBendUpRight)} onPress={() => onChange({ kind: "move", items })} />}
      {edit && canVault && items.every((i) => !i.role && !i.shortcut) && <SheetRow label="Move to vault" needsNet icon={ic(Lock)} onPress={() => onChange({ kind: "vault", items })} />}
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
          needsNet
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
          needsNet
          icon={ic(X)}
          onPress={() => {
            actions.removeShortcut(one)
            done()
          }}
        />
      )}
      <SheetRow label="Tags" icon={ic(TagIcon)} onPress={() => onChange({ kind: "tags", items })} />
      {file && edit && (
        <SheetRow
          label="Versions"
          needsNet
          icon={ic(ClockCounterClockwise)}
          onPress={() => {
            done()
            router.push({ pathname: "/versions/[id]", params: { id: file.id, name: file.name } })
          }}
        />
      )}
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
      {file && edit && (
        <SheetRow
          label="Change thumbnail"
          needsNet
          icon={ic(ImageIcon)}
          onPress={async () => {
            try {
              const r = await whilePicking(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 }))
              if (r.canceled) return
              await actions.setThumb(file, await imageToWebp(r.assets[0].uri))
              snack({ text: "Thumbnail changed." })
            } catch (e) {
              snack({ text: errorText(e), error: true })
            }
          }}
        />
      )}
      {file && edit && !!file.thumb && (
        <SheetRow
          label="Reset thumbnail"
          needsNet
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

// A row of Details that opens something: caption, value, caret.
function DetailLink({ caption, label: a11y, onPress, children }: { caption: string; label: string; onPress: () => void; children: ReactNode }) {
  const dismiss = useDismiss()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      android_ripple={{ color: c.ripple }}
      onPress={() => dismiss(onPress)}
      style={{ minHeight: 56, paddingHorizontal: 20, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 12 }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="caption" color={mute}>{caption}</Text>
        {children}
      </View>
      <CaretRight size={16} color={mute} />
    </Pressable>
  )
}

// "v4, 3 older". The server answers an empty list to anyone who can't see versions.
function VersionsLink({ item }: { item: Item }) {
  const q = useVersions(item.id)
  const list = q.data ?? []
  const current = list.find((v) => v.current)
  if (!current) return null
  const older = list.length - 1
  const text = `v${current.number}${older ? `, ${older} older` : ""}`
  return (
    <DetailLink caption="Versions" label={`Versions, ${text}`} onPress={() => router.push({ pathname: "/versions/[id]", params: { id: item.id, name: item.name } })}>
      <Text>{text}</Text>
    </DetailLink>
  )
}

// Who can see this, by face. Anyone who can't manage sharing gets the plain line it replaces.
function WhoHasAccess({ item, fallback }: { item: Item; fallback: ReactNode }) {
  const api = useApi()
  const q = useShareState(item.id)
  const s = q.data
  if (!s) return <>{fallback}</>
  const links = s.links.length ? plural(s.links.length, "public link") : null
  const who = s.people.length ? `${s.people.length + 1} people` : s.isOwner ? "Only you" : s.owner.name
  const text = [who, links].filter(Boolean).join(" · ")
  const faces = [s.owner, ...s.people.filter((p) => !p.invited)]
  return (
    <DetailLink caption="Who has access" label={`Who has access: ${text}. Share`} onPress={() => router.push({ pathname: "/share/[id]", params: { id: item.id, name: item.name } })}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flexDirection: "row" }}>
          {faces.slice(0, 5).map((p, i) => (
            <View key={i} style={{ marginLeft: i ? -8 : 0, borderRadius: 14, borderWidth: 2, borderColor: c.card }}>
              <Avatar account={api.account} name={p.name} image={p.image} size={24} />
            </View>
          ))}
        </View>
        <Text style={{ flex: 1 }}>{text}</Text>
      </View>
    </DetailLink>
  )
}

function DetailsSheet({ item, role, trash, tags, onChange, onClose, ask }: Props & { item: Item; onClose: () => void; ask: (d: Dialog) => void }) {
  const offline = useOfflineActions()
  const isKept = offline.snap.covered.has(item.id)
  const via = isKept && offline.snap.rootOf.get(item.id) !== item.id ? offline.snap.roots.find((r) => r.id === offline.snap.rootOf.get(item.id)) : undefined
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
  ]
  const sharingLine = value(d && (d.shares === null ? "Shared with you" : d.shares ? `Shared ${plural(d.shares, "time")}` : "Only you"))
  const row = (name: string, v: ReactNode) => (
    <View key={name} style={{ minHeight: 48, paddingHorizontal: 20, paddingVertical: 8, gap: 2 }}>
      <Text variant="caption" color={mute}>
        {name}
      </Text>
      {v}
    </View>
  )

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
      {rows.map(([name, v]) => row(name, v))}
      {!trash && !item.shortcut && (
        <SwitchRow
          label="Available offline"
          detail={via ? `Kept by “${via.name}”` : isKept ? (item.kind === "file" && !offline.snap.files.has(item.id) ? "Waiting to download" : "Saved on this phone") : "Keep a copy that opens with no connection"}
          value={isKept}
          disabled={!!via}
          onChange={async (on) => {
            const over = await offline.set([item], on)
            if (over) ask({ kind: "cap", ask: over })
          }}
        />
      )}
      {!trash && shareable(item, role) ? <WhoHasAccess item={item} fallback={row("Sharing", sharingLine)} /> : row("Sharing", sharingLine)}
      {!trash && item.kind === "file" && (
        <DetailLink
          caption="Comments"
          label={`Comments, ${item.comments ? `${item.comments} open` : "none open"}`}
          onPress={() => router.push({ pathname: "/comments/[id]", params: { id: item.id, name: item.name } })}
        >
          <Text>{item.comments ? `${item.comments} open thread${item.comments === 1 ? "" : "s"}` : "Add a comment"}</Text>
        </DetailLink>
      )}
      {!trash && item.kind === "file" && editable([item], role) && <VersionsLink item={item} />}
      <ActivityList item={item} />
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
  const { account } = useApi()
  const { send, scan } = useUploader()
  const snack = useSnack()
  const canScan = useQuery({ queryKey: ["scanAvailable"], queryFn: () => native?.scanAvailable() ?? false, staleTime: Infinity }).data
  const row = (label: string, icon: Icon, chosen: () => Promise<Entry[] | null>) => (
    <SheetRow
      label={label}
      icon={createElement(icon, { size: ICON, color: mute })}
      onPress={async () => {
        try {
          const entries = await chosen()
          if (entries === null) snack({ text: "Nimbus needs camera access for that. You can allow it in Android's settings.", error: true })
          else send(account, parentId, entries)
        } catch (e) {
          snack({ text: errorText(e), error: true })
        }
      }}
    />
  )
  return (
    <Sheet onClose={onClose} header={<Header title="New" />}>
      <SheetRow label="New folder" icon={<FolderPlus size={ICON} color={mute} />} onPress={() => ask({ kind: "folder", parentId })} />
      <SheetDivider />
      {row("Upload files", UploadSimple, pick.files)}
      {row("Upload folder", FolderOpen, pick.folder)}
      {row("Upload photos or videos", ImagesSquare, pick.media)}
      <SheetDivider />
      {row("Take a photo", CameraIcon, () => pick.camera("images"))}
      {row("Record a video", VideoCamera, () => pick.camera("videos"))}
      {canScan && row("Scan a document", Scan, scan)}
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
