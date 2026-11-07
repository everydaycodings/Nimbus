// A vault's files and its trash: the Files browser's tiles over the decrypted tree, with vault chrome and a name filter.
// No star, share, versions, tags, offline or thumbnails: the server can't see any of it.
import { formatBytes } from "@nimbus/shared/file-rules"
import * as Haptics from "expo-haptics"
import { router, useFocusEffect } from "expo-router"
import {
  ArrowBendUpRight,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowLeft,
  ArrowSquareOut,
  ArrowUp,
  CaretRight,
  Camera as CameraIcon,
  DotsThreeVertical,
  DownloadSimple,
  FolderOpen,
  FolderPlus,
  GearSix,
  ImagesSquare,
  Info,
  LinkSimple,
  LockSimple,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Rows,
  Scan,
  SelectionAll,
  SquaresFour,
  Trash,
  UploadSimple,
  UploadSimple as MoveOut,
  X,
  type Icon,
} from "phosphor-react-native"
import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ActivityIndicator, BackHandler, FlatList, Pressable, RefreshControl, ScrollView, TextInput, View, useWindowDimensions } from "react-native"
import { useSharedValue } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ConfirmDialog, PromptDialog } from "@/components/dialog"
import { FileIcon } from "@/components/file-icon"
import { FileSheets } from "@/components/file-sheets"
import { isWide } from "@/components/nav"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { FileCard, FolderTile, ListRow, type TileProps } from "@/components/tiles"
import { useUploader } from "@/components/uploader"
import { Bar, Button, Fab, IconButton, Text } from "@/components/ui"
import { VaultLinkDialog } from "@/components/vault-link-dialog"
import { FolderSheet, useMyFolders, vaultFolders } from "@/components/vault-sheets"
import { useVaultLock, whilePicking } from "@/components/vault-lock"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { usePrefs } from "@/lib/prefs"
import { openPreview } from "@/lib/preview-session"
import { columnsFor, toRows, type Row } from "@/lib/rows"
import { c, radius, type } from "@/lib/theme"
import { engine, pick, useUploadRows } from "@/lib/uploads"
import { takeIntake, toItem, useVaultTree, type VaultNative } from "@/lib/vault"
import { useVaultOps } from "@/lib/vault-ops"
import { useCanShareLinks } from "@/lib/vault-links"
import { filtered, kidsOf, live, pathTo, sorted, trashRoots, type VaultEntry } from "@/lib/vault-rules"

const ICON = 24
const SORTS = { name: "Name", date: "Modified", size: "Size" }
const NO_TAGS = new Map()
const full = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

type Sheets =
  | { kind: "new" }
  | { kind: "menu" }
  | { kind: "actions"; items: VaultEntry[] }
  | { kind: "details"; item: VaultEntry }
  | { kind: "move"; items: VaultEntry[] }
  | { kind: "out"; items: VaultEntry[] }
type Dialogs =
  | { kind: "folder" }
  | { kind: "rename"; item: VaultEntry }
  | { kind: "forever"; items: VaultEntry[] }
  | { kind: "copy"; items: VaultEntry[] }
  | { kind: "link"; items: VaultEntry[] }

function Header({ icon, title, caption }: { icon?: ReactNode; title: string; caption?: string }) {
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.border, marginBottom: 4, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 20, paddingBottom: 8 }}>
      {icon}
      <View style={{ flex: 1 }}>
        <Text variant="titleSmall" numberOfLines={1}>{title}</Text>
        {caption && <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>{caption}</Text>}
      </View>
    </View>
  )
}

const headerFor = (items: VaultEntry[]) =>
  items.length === 1 ? (
    <Header icon={<FileIcon item={items[0]} />} title={items[0].name} caption={[full(items[0].updatedAt), items[0].kind === "file" ? formatBytes(items[0].size) : null].filter(Boolean).join(" · ")} />
  ) : (
    <Header title={`${items.length} items`} />
  )

const Centered = ({ title, body, action }: { title: string; body?: string; action?: ReactNode }) => (
  <View style={{ alignItems: "center", paddingVertical: 64, paddingHorizontal: 24, gap: 8 }}>
    <Text variant="titleSmall" style={{ textAlign: "center" }}>{title}</Text>
    {body ? <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>{body}</Text> : null}
    {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
  </View>
)

function Crumb({ label, first, onPress }: { label: string; first?: boolean; onPress: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {!first && <CaretRight size={14} color={c.mutedForeground} />}
      <Pressable
        onPress={onPress}
        android_ripple={{ color: c.ripple }}
        accessibilityRole="button"
        accessibilityLabel={`Go to ${label}`}
        style={{ minHeight: 48, paddingHorizontal: 8, justifyContent: "center", borderRadius: radius.control }}
      >
        <Text variant="bodySmall" color={c.mutedForeground}>{label}</Text>
      </Pressable>
    </View>
  )
}

export function VaultBrowser({ vaultId, name, trash, vn }: { vaultId: string; name: string; trash?: boolean; vn: VaultNative }) {
  const api = useApi()
  const inset = useSafeAreaInsets()
  const snack = useSnack()
  const { lock } = useVaultLock()
  const uploader = useUploader()
  const { width: screen } = useWindowDimensions()
  const [prefs, setPrefs] = usePrefs(api.id)
  const tree = useVaultTree(vaultId, vn)
  const all = useMemo(() => tree.entries ?? [], [tree.entries])
  const ops = useVaultOps(vaultId, vn, all, tree.reload)
  const canLink = useCanShareLinks()

  const [folder, setFolder] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sheet, setSheet] = useState<Sheets | null>(null)
  const [dialog, setDialog] = useState<Dialogs | null>(null)
  const [sorting, setSorting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // A folder that went away (moved to the trash, or by another device) shows its parent's contents again.
  const here = folder && live(all).some((e) => e.id === folder && e.kind === "folder") ? folder : null
  const items = useMemo(() => {
    const base = trash ? trashRoots(all) : query.trim() ? live(all) : kidsOf(all, here)
    return sorted(filtered(base, query), prefs.sort, prefs.order)
  }, [all, trash, query, here, prefs.sort, prefs.order])
  const byId = useMemo(() => new Map(items.map((e) => [e.id, e])), [items])
  const shown = useMemo(() => items.map(toItem), [items])
  const selecting = selectedIds.size > 0
  const selected = useMemo(() => items.filter((e) => selectedIds.has(e.id)), [items, selectedIds])
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  useEffect(() => clearSelection(), [query, here, clearSelection])

  const up = useCallback(() => {
    const parent = pathTo(all, here).at(-1)?.parentId ?? null
    setFolder(parent)
  }, [all, here])
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (selecting) clearSelection()
        else if (query) setQuery("")
        else if (here && !trash) up()
        else return false
        return true
      })
      return () => sub.remove()
    }, [selecting, query, here, trash, clearSelection, up])
  )
  useFocusEffect(useCallback(() => clearSelection, [clearSelection]))

  // Finished vault uploads change the tree.
  const rows = useUploadRows(api.id)
  const done = rows.filter((r) => r.vaultId === vaultId && r.status === "done").length
  useEffect(() => {
    if (done) tree.soon()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- soon is rebuilt with the tree
  }, [done])

  // What was waiting for this vault to unlock: files moved from My files, or shared in from another app.
  const taken = useRef(false)
  useEffect(() => {
    if (taken.current || !tree.entries || trash) return
    taken.current = true
    const intake = takeIntake(vaultId)
    if (!intake) return
    if (intake.items) ops.moveIn(intake.items, null)
    else if (intake.files)
      ops.send(intake.files, null).then(
        (r) => {
          if (r.queued && intake.exit) BackHandler.exitApp()
        },
        (e) => snack({ text: errorText(e), error: true })
      )
  })

  // ---- Taps ----
  const press = (item: { id: string }) => {
    const entry = byId.get(item.id)
    if (!entry) return
    if (selecting) {
      setSelectedIds((s) => {
        const next = new Set(s)
        if (!next.delete(entry.id)) next.add(entry.id)
        return next
      })
    } else if (trash) setSheet({ kind: "details", item: entry })
    else if (entry.kind === "folder") {
      setQuery("")
      setFolder(entry.id)
    } else {
      const files = shown.filter((i) => i.kind === "file")
      openPreview({ items: files, index: files.findIndex((i) => i.id === entry.id), role: "owner", vault: vaultId })
    }
  }
  const longPress = (item: { id: string }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    setSelectedIds((s) => new Set(s).add(item.id))
  }
  const menu = (item: { id: string }) => {
    const entry = byId.get(item.id)
    if (entry) setSheet({ kind: "actions", items: [entry] })
  }
  const latest = useRef({ press, longPress, menu })
  latest.current = { press, longPress, menu }
  const onPress = useCallback((i: { id: string }) => latest.current.press(i), [])
  const onLongPress = useCallback((i: { id: string }) => latest.current.longPress(i), [])
  const onMenu = useCallback((i: { id: string }) => latest.current.menu(i), [])

  // ---- Rows ----
  const compact = prefs.compact
  const gap = compact ? 8 : 12
  const asList = prefs.layout === "list"
  const columns = asList ? 1 : columnsFor(screen - (isWide(screen) ? 80 : 0), prefs.tiles, gap)
  const list = useMemo(() => toRows(shown, columns, asList ? "list" : "grid"), [shown, columns, asList])
  const tile = (item: TileProps["item"]): TileProps => ({
    item, tags: NO_TAGS, selected: selectedIds.has(item.id), selecting, compact, onPress: onPress as TileProps["onPress"], onLongPress: onLongPress as TileProps["onLongPress"], onMenu: onMenu as TileProps["onMenu"],
  })
  const renderItem = ({ item: row }: { item: Row }) => {
    if (row.type === "header") return <Text variant="label" color={c.mutedForeground} style={{ paddingTop: 8, paddingBottom: 8 }}>{row.title}</Text>
    if (row.type === "item") return <ListRow {...tile(row.item)} />
    const Tile = row.type === "folders" ? FolderTile : FileCard
    return (
      <View style={{ flexDirection: "row", gap, marginBottom: gap }}>
        {row.items.map((i) => <Tile key={i.id} {...tile(i)} />)}
        {Array.from({ length: columns - row.items.length }, (_, k) => <View key={`s${k}`} style={{ flex: 1, borderWidth: 1, borderColor: "transparent" }} />)}
      </View>
    )
  }

  const grown = useSharedValue(1)
  const lastY = useRef(0)
  const showFab = !trash && !selecting && !!tree.entries

  // ---- Picking what to upload ----
  const upload = async (chosen: () => Promise<{ path: string; size: number; uri?: string; mime?: string }[] | null>) => {
    try {
      const entries = await whilePicking(chosen)
      if (entries === null) return snack({ text: "Nimbus needs camera access for that. You can allow it in Android's settings.", error: true })
      if (!entries.length) return
      const r = await ops.send(entries, here)
      if (r.queued) snack({ text: `Encrypting and uploading ${plural(r.queued, "file")}.` })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }
  const canScan = typeof vn.scanAvailable === "function"

  // ---- Top ----
  const crumbs = pathTo(all, here)
  const lockButton = <IconButton icon={LockSimple} label="Lock vault" color={c.brand} onPress={() => lock(vaultId)} />
  let top: ReactNode
  if (selecting)
    top = (
      <Bar>
        <IconButton icon={X} label="Clear selection" onPress={clearSelection} />
        <Text variant="title" style={{ flex: 1 }} numberOfLines={1} accessibilityLiveRegion="polite">{selectedIds.size} selected</Text>
        {trash ? (
          <>
            <IconButton icon={ArrowCounterClockwise} label="Restore" onPress={() => { ops.restore(selected); clearSelection() }} />
            <IconButton icon={SelectionAll} label="Select all" onPress={() => setSelectedIds(new Set(items.map((i) => i.id)))} />
            <IconButton icon={Trash} label="Delete forever" color={c.destructive} onPress={() => setDialog({ kind: "forever", items: selected })} />
          </>
        ) : (
          <>
            <IconButton icon={DownloadSimple} label="Download" onPress={() => setDialog({ kind: "copy", items: selected })} />
            <IconButton icon={ArrowBendUpRight} label="Move" onPress={() => setSheet({ kind: "move", items: selected })} />
            <IconButton icon={Trash} label="Move to trash" color={c.destructive} onPress={() => { ops.trash(selected); clearSelection() }} />
            <IconButton icon={DotsThreeVertical} label="More actions" onPress={() => setSheet({ kind: "actions", items: selected })} />
          </>
        )}
      </Bar>
    )
  else
    top = (
      <>
        <Bar>
          <IconButton icon={ArrowLeft} label="Back" onPress={() => (here && !trash ? up() : router.back())} />
          <View style={{ flex: 1 }}>
            <Text variant="title" numberOfLines={1} accessibilityRole="header">{trash ? "Trash" : crumbs.at(-1)?.name ?? name}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <LockSimple size={12} weight="fill" color={c.brand} />
              <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>{trash ? name : "Encrypted, unlocked"}</Text>
            </View>
          </View>
          {trash ? (
            items.length > 0 && <Button variant="text" danger label="Empty trash" onPress={() => setDialog({ kind: "forever", items })} />
          ) : (
            <>
              {lockButton}
              <IconButton icon={DotsThreeVertical} label="Vault menu" onPress={() => setSheet({ kind: "menu" })} />
            </>
          )}
        </Bar>
        {!trash && here && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8, alignItems: "center" }} style={{ flexGrow: 0 }}>
            <Crumb first label={name} onPress={() => setFolder(null)} />
            {crumbs.slice(0, -1).map((p) => <Crumb key={p.id} label={p.name} onPress={() => setFolder(p.id)} />)}
          </ScrollView>
        )}
        {!!tree.entries && (
          <View style={{ marginHorizontal: 16, marginTop: 4, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 16, borderRadius: radius.pill, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}>
            <MagnifyingGlass size={20} color={c.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Filter by name"
              placeholderTextColor={c.mutedForeground}
              accessibilityLabel="Filter by name"
              selectionColor={c.brand}
              cursorColor={c.brand}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              style={[type.body, { flex: 1, color: c.foreground, paddingVertical: 10 }]}
            />
            {!!query && <IconButton icon={X} label="Clear filter" onPress={() => setQuery("")} />}
          </View>
        )}
      </>
    )

  const SortIcon = prefs.order === "asc" ? ArrowUp : ArrowDown
  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Pressable
        onPress={() => setSorting(true)}
        android_ripple={{ color: c.ripple }}
        accessibilityRole="button"
        accessibilityLabel={`Sort by ${SORTS[prefs.sort].toLowerCase()}, ${prefs.order === "asc" ? "ascending" : "descending"}`}
        style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6 }}
      >
        <Text variant="label">{SORTS[prefs.sort]}</Text>
        <SortIcon size={16} color={c.foreground} />
      </Pressable>
      <IconButton icon={prefs.layout === "grid" ? Rows : SquaresFour} label={prefs.layout === "grid" ? "Switch to list view" : "Switch to grid view"} onPress={() => setPrefs({ layout: prefs.layout === "grid" ? "list" : "grid" })} />
    </View>
  )

  const empty = () => {
    if (!tree.entries)
      return tree.error ? (
        <Centered title={tree.error} action={<Button variant="outlined" label="Try again" onPress={() => tree.reload()} />} />
      ) : (
        <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Loading" style={{ paddingVertical: 64 }} />
      )
    if (query.trim()) return <Centered title={`No results for “${query.trim()}”.`} />
    if (trash) return <Centered title="The trash is empty." />
    return <Centered title={here ? "This folder is empty" : "This vault is empty"} body="Tap New to add files or a folder. They're encrypted before they leave your phone." />
  }

  // ---- Sheets ----
  const ic = (I: Icon) => createElement(I, { size: ICON, color: c.mutedForeground })
  const sheets = () => {
    if (!sheet) return null
    const close = () => setSheet(null)
    switch (sheet.kind) {
      case "new":
        return (
          <Sheet onClose={close} header={<Header title="New" />}>
            <SheetRow label="New folder" icon={ic(FolderPlus)} onPress={() => setDialog({ kind: "folder" })} />
            <SheetDivider />
            <SheetRow label="Files" icon={ic(UploadSimple)} onPress={() => upload(pick.files)} />
            <SheetRow label="Folder" icon={ic(FolderOpen)} onPress={() => upload(pick.folder)} />
            <SheetRow label="Photos or videos" icon={ic(ImagesSquare)} onPress={() => upload(pick.media)} />
            <SheetDivider />
            {canScan && <SheetRow label="Scan document" icon={ic(Scan)} onPress={() => upload(uploader.scan)} />}
            <SheetRow label="Take photo" icon={ic(CameraIcon)} onPress={() => upload(() => pick.camera("images"))} />
          </Sheet>
        )
      case "menu":
        return (
          <Sheet onClose={close} header={<Header icon={<LockSimple size={ICON} weight="fill" color={c.brand} />} title={name} caption="Encrypted on this phone" />}>
            <SheetRow label="Trash" icon={ic(Trash)} onPress={() => router.push({ pathname: "/vault/[id]/trash", params: { id: vaultId, name } })} />
            <SheetRow label="Vault settings" icon={ic(GearSix)} onPress={() => router.push({ pathname: "/vault/[id]/settings", params: { id: vaultId, name } })} />
          </Sheet>
        )
      case "details": {
        const e = sheet.item
        const where = pathTo(all, e.parentId).map((p) => p.name)
        const row = (label: string, value: string) => (
          <View key={label} style={{ minHeight: 48, paddingHorizontal: 20, paddingVertical: 8, gap: 2 }}>
            <Text variant="caption" color={c.mutedForeground}>{label}</Text>
            <Text>{value}</Text>
          </View>
        )
        return (
          <Sheet onClose={close} header={headerFor([e])}>
            {row("Type", e.kind === "folder" ? "Folder" : (e.mime ?? "Unknown"))}
            {e.kind === "file" && row("Size", `${formatBytes(e.size)} (${e.size.toLocaleString()} bytes)`)}
            {row("Location", [name, ...where].join(" / "))}
            {row("Modified", full(e.updatedAt))}
            {e.trashedAt && row("Trashed", full(e.trashedAt))}
          </Sheet>
        )
      }
      case "actions": {
        const list = sheet.items
        const one = list.length === 1 ? list[0] : null
        const file = one?.kind === "file" ? one : null
        const clear = clearSelection
        if (trash)
          return (
            <Sheet onClose={close} header={headerFor(list)}>
              {one && <SheetRow label="Details" icon={ic(Info)} onPress={() => setSheet({ kind: "details", item: one })} />}
              <SheetRow label="Restore" icon={ic(ArrowCounterClockwise)} onPress={() => { ops.restore(list); clear() }} />
              <SheetDivider />
              <SheetRow label="Delete forever" danger icon={<Trash size={ICON} color={c.destructive} />} onPress={() => setDialog({ kind: "forever", items: list })} />
            </Sheet>
          )
        return (
          <Sheet onClose={close} header={headerFor(list)}>
            {one?.kind === "folder" && <SheetRow label="Open" icon={ic(FolderOpen)} onPress={() => { setQuery(""); setFolder(one.id) }} />}
            <SheetRow label={file ? "Download" : "Download as ZIP"} icon={ic(DownloadSimple)} onPress={() => setDialog({ kind: "copy", items: list })} />

            {canLink && <SheetRow label="Share link" icon={ic(LinkSimple)} onPress={() => setDialog({ kind: "link", items: list })} />}
            {file && <SheetRow label="Open with" icon={ic(ArrowSquareOut)} onPress={() => ops.openWith(file)} />}
            {one && <SheetRow label="Rename" icon={ic(PencilSimple)} onPress={() => setDialog({ kind: "rename", item: one })} />}
            <SheetRow label="Move" icon={ic(ArrowBendUpRight)} onPress={() => setSheet({ kind: "move", items: list })} />
            <SheetRow label="Move out to My files" icon={createElement(MoveOut, { size: ICON, color: c.mutedForeground })} onPress={() => setSheet({ kind: "out", items: list })} />
            {one && (
              <>
                <SheetDivider />
                <SheetRow label="Details" icon={ic(Info)} onPress={() => setSheet({ kind: "details", item: one })} />
              </>
            )}
            <SheetDivider />
            <SheetRow label="Move to trash" danger icon={<Trash size={ICON} color={c.destructive} />} onPress={() => { ops.trash(list); clear() }} />
          </Sheet>
        )
      }
      case "move":
        return (
          <FolderSheet
            root={name}
            caption={`Move ${plural(sheet.items.length, "item")}`}
            kids={vaultFolders(all, sheet.items)}
            onClose={close}
            onPick={(to) => { ops.move(sheet.items, to.id, to.id ? `“${to.name}”` : "the vault's top level"); clearSelection() }}
          />
        )
      case "out":
        return (
          <FolderSheet
            root="My files"
            caption={`Move ${plural(sheet.items.length, "item")} out of the vault`}
            kids={useMyFolders}
            onClose={close}
            onPick={(to) => { ops.moveOut(sheet.items, to.id, to.name); clearSelection() }}
          />
        )
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {top}
      <FlatList
        data={tree.entries ? list : []}
        renderItem={renderItem}
        keyExtractor={(r) => r.key}
        extraData={selectedIds}
        ListHeaderComponent={tree.entries ? header : undefined}
        ListEmptyComponent={<>{empty()}</>}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        onScroll={(e) => {
          const y = Math.max(0, e.nativeEvent.contentOffset.y)
          const dy = y - lastY.current
          if (Math.abs(dy) < 8) return
          lastY.current = y
          grown.value = dy < 0 || y < 8 ? 1 : 0
        }}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true)
              await tree.reload()
              setRefreshing(false)
            }}
            colors={[c.foreground]}
            progressBackgroundColor={c.muted}
          />
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: showFab ? 96 : inset.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
      {showFab && <Fab label="New" icon={<Plus size={24} color={c.primaryForeground} />} extended={grown} onPress={() => setSheet({ kind: "new" })} />}

      {sheets()}
      <FileSheets
        sheet={sorting ? { kind: "sort" } : null}
        onChange={(s) => setSorting(!!s)}
        role="owner"
        trash={false}
        tags={[]}
        filters={{}}
        onFilters={() => {}}
        tagFilter={false}
        sortable
        onOpen={() => {}}
      />

      {dialog?.kind === "folder" && (
        <PromptDialog title="New folder" label="Folder name" confirm="Create" onClose={() => setDialog(null)} onSubmit={(n) => ops.createFolder(here, n)} />
      )}
      {dialog?.kind === "rename" && (
        <PromptDialog
          title="Rename"
          label="Name"
          confirm="Rename"
          initial={dialog.item.name}
          selectEnd={dialog.item.kind === "file" && dialog.item.name.lastIndexOf(".") > 0 ? dialog.item.name.lastIndexOf(".") : dialog.item.name.length}
          onClose={() => setDialog(null)}
          onSubmit={async (n) => {
            const problem = await ops.rename(dialog.item, n)
            if (!problem) clearSelection()
            return problem
          }}
        />
      )}
      {dialog?.kind === "forever" && (
        <ConfirmDialog
          title="Delete forever?"
          body={`${dialog.items.length === 1 ? `“${dialog.items[0].name}”` : plural(dialog.items.length, "item")} will be deleted forever. This can't be undone.`}
          confirm="Delete forever"
          onClose={() => setDialog(null)}
          onConfirm={() => { ops.remove(dialog.items); clearSelection() }}
        />
      )}
      {dialog?.kind === "copy" && (
        <ConfirmDialog
          title="Save an unencrypted copy?"
          body="The copy on your phone isn't protected by the vault. Anyone who can open that folder can read it."
          confirm="Save copy"
          danger={false}
          onClose={() => setDialog(null)}
          onConfirm={() => { ops.download(dialog.items); clearSelection() }}
        />
      )}
      {dialog?.kind === "link" && <VaultLinkDialog vaultId={vaultId} vn={vn} all={all} targets={dialog.items} onClose={() => { setDialog(null); clearSelection() }} />}
    </View>
  )
}
