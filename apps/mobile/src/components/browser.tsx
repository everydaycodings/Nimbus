import type { Item, Tag } from "@nimbus/shared/api"
import * as Haptics from "expo-haptics"
import { router, useFocusEffect } from "expo-router"
import {
  ArrowDown,
  ArrowBendUpRight,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowUp,
  CaretDown,
  CaretRight,
  DotsThreeVertical,
  MagnifyingGlass,
  Plus,
  Rows,
  SelectionAll,
  SquaresFour,
  Star,
  Trash,
  X,
} from "phosphor-react-native"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native"
import { useSharedValue } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { AccountSheet } from "@/components/account-sheet"
import { Avatar, serverName } from "@/components/avatar"
import { ConfirmDialog } from "@/components/dialog"
import { FILTER_LABELS, FileSheets } from "@/components/file-sheets"
import { isWide } from "@/components/nav"
import { FileCard, FolderTile, ListRow, type TileProps } from "@/components/tiles"
import { useSnack } from "@/components/snackbar"
import { Bar, Button, Fab, IconButton, Text } from "@/components/ui"
import { FILE_TYPES } from "@/components/file-icon"
import { ApiError, errorText } from "@/lib/api"
import {
  editable,
  keepsServerOrder,
  label as itemsLabel,
  useApi,
  useFileActions,
  useList,
  useMe,
  useRestart,
  type FileSheet,
  type Filters,
  type Source,
} from "@/lib/files"
import { usePrefs } from "@/lib/prefs"
import { columnsFor, toRows, type Row } from "@/lib/rows"
import { folderHref, homeHref, useTab, type TabGroup } from "@/lib/tab"
import { c, radius, type } from "@/lib/theme"

const SORTS = { name: "Name", date: "Modified", size: "Size" }

// The 48dp box is the press target and the 40dp pill is only what you see. The clear X is a
// sibling, not a child, so TalkBack reaches it on its own.
function Chip({ label, value, onPress, onClear }: { label: string; value?: string; onPress: () => void; onClear: () => void }) {
  return (
    <View style={{ minHeight: 48, justifyContent: "center" }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}: ${value}. Change filter` : `Filter by ${label.toLowerCase()}`}
        style={{ minHeight: 48, justifyContent: "center" }}
      >
        {({ pressed }) => (
          <View
            style={{
              height: 40,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 14,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: value ? c.brand : c.input,
              backgroundColor: pressed ? c.ripple : value ? c.brandWash : "transparent",
            }}
          >
            <Text variant="label">{value ?? label}</Text>
            {value ? <View style={{ width: 16 }} /> : <CaretDown size={14} color={c.mutedForeground} />}
          </View>
        )}
      </Pressable>
      {value && (
        <Pressable
          onPress={onClear}
          android_ripple={{ color: c.ripple, borderless: true, radius: 20 }}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label.toLowerCase()} filter`}
          style={{ position: "absolute", right: -2, top: 0, width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
        >
          <X size={16} color={c.foreground} />
        </Pressable>
      )}
    </View>
  )
}

function Centered({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 64, paddingHorizontal: 24, gap: 8 }}>
      <Text variant="titleSmall" style={{ textAlign: "center" }}>
        {title}
      </Text>
      {body ? (
        <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  )
}

function emptyCopy(source: Source): [string, string?] {
  switch (source.kind) {
    case "files":
      return ["No files yet", "Tap New to create a folder."]
    case "folder":
      return ["This folder is empty"]
    case "recent":
      return ["Files you open show up here."]
    case "starred":
      return ["Star files to find them fast."]
    case "shared":
      return [source.by ? "You haven't shared anything yet." : "Nothing has been shared with you yet."]
    case "trash":
      return ["The trash is empty."]
    case "tag":
      return ["Nothing has this tag yet."]
    case "search":
      return [source.q ? `No results for “${source.q}”.` : "Search names and text inside your files."]
  }
}

export function Browser({ source: given, top, name }: { source: Source; top?: ReactNode; name?: string }) {
  const api = useApi()
  const me = useMe()
  const inset = useSafeAreaInsets()
  const tab = useTab()
  const restart = useRestart()
  const actions = useFileActions()
  const snack = useSnack()
  const { width: screen } = useWindowDimensions()
  const [prefs, setPrefs] = usePrefs(api.id)

  const [by, setBy] = useState<"me" | undefined>()
  const source: Source = given.kind === "shared" ? { kind: "shared", by } : given
  const [filters, setFilters] = useState<Filters>({})
  const [sheet, setSheet] = useState<FileSheet | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<"empty" | "delete" | null>(null)
  const [account, setAccount] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const query = useMemo(
    () => ({ ...filters, ...(keepsServerOrder(source) ? {} : { sort: prefs.sort, order: prefs.order }) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- source is rebuilt each render; its kind is what matters
    [filters, prefs.sort, prefs.order, source.kind]
  )
  const list = useList(source, query)
  const { items, first } = list
  const role = first?.folder?.role ?? "owner"
  const isSearch = source.kind === "search"
  const isTrash = source.kind === "trash"

  const tags = useMemo(() => new Map<string, Tag>((first?.tags ?? []).map((t) => [t.id, t])), [first?.tags])

  // ---- Selection ----
  const selecting = selectedIds.size > 0
  const selected = useMemo(() => items.filter((i) => selectedIds.has(i.id)), [items, selectedIds])
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  const selectAll = useCallback(() => setSelectedIds(new Set(items.map((i) => i.id))), [items])

  useFocusEffect(
    useCallback(() => {
      const sub = selecting
        ? BackHandler.addEventListener("hardwareBackPress", () => {
            clearSelection()
            return true
          })
        : undefined
      return () => sub?.remove()
    }, [selecting, clearSelection])
  )
  // The bar counts every selected id but acts on the visible ones, so a filter change starts over.
  useEffect(() => {
    clearSelection()
  }, [filters, clearSelection])
  // Leaving the screen drops the selection.
  useFocusEffect(useCallback(() => clearSelection, [clearSelection]))

  // ---- Taps ----
  // The name rides along so the title shows while the folder loads or fails.
  const open = useCallback((item: Item) => router.push({ pathname: folderHref(tab, item.id), params: { name: item.name } }), [tab])
  const press = (item: Item) => {
    if (selecting) {
      setSelectedIds((s) => {
        const next = new Set(s)
        if (!next.delete(item.id)) next.add(item.id)
        return next
      })
    } else if (item.kind === "folder" && !isTrash) open(item)
    else setSheet({ kind: "details", item })
  }
  const longPress = (item: Item) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    setSelectedIds((s) => new Set(s).add(item.id))
  }
  const menu = (item: Item) => setSheet({ kind: "actions", items: [item] })
  // The tiles are memoised; they get these stable wrappers and the latest closures through the ref.
  const latest = useRef({ press, longPress, menu })
  latest.current = { press, longPress, menu }
  const onPress = useCallback((item: Item) => latest.current.press(item), [])
  const onLongPress = useCallback((item: Item) => latest.current.longPress(item), [])
  const onMenu = useCallback((item: Item) => latest.current.menu(item), [])

  // ---- Rows ----
  const compact = prefs.compact
  const gap = compact ? 8 : 12
  const asList = isSearch || prefs.layout === "list"
  const width = screen - (isWide(screen) ? 80 : 0)
  const columns = asList ? 1 : columnsFor(width, prefs.tiles, gap)
  const rows = useMemo(() => toRows(items, columns, asList ? "list" : "grid"), [items, columns, asList])

  const tile = (item: Item): TileProps => ({
    item,
    tags,
    selected: selectedIds.has(item.id),
    selecting,
    compact,
    onPress,
    onLongPress,
    onMenu,
  })
  const renderItem = ({ item: row }: { item: Row }) => {
    if (row.type === "header")
      return (
        <Text variant="label" color={c.mutedForeground} style={{ paddingTop: 8, paddingBottom: 8 }}>
          {row.title}
        </Text>
      )
    if (row.type === "item") return <ListRow {...tile(row.item)} />
    const Tile = row.type === "folders" ? FolderTile : FileCard
    return (
      <View style={{ flexDirection: "row", gap, marginBottom: gap }}>
        {row.items.map((i) => (
          <Tile key={i.id} {...tile(i)} />
        ))}
        {Array.from({ length: columns - row.items.length }, (_, k) => (
          <View key={`s${k}`} style={{ flex: 1, borderWidth: 1, borderColor: "transparent" }} />
        ))}
      </View>
    )
  }

  // ---- FAB ----
  const showFab = !top && !selecting && (source.kind === "files" || (source.kind === "folder" && !!first && role !== "viewer"))
  const grown = useSharedValue(1)
  const lastY = useRef(0)
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = Math.max(0, e.nativeEvent.contentOffset.y)
    const dy = y - lastY.current
    if (Math.abs(dy) < 8) return
    lastY.current = y
    grown.value = dy < 0 || y < 8 ? 1 : 0
  }

  // ---- Errors ----
  const failure = !first && list.isError ? (list.error as Error) : null
  const status = failure instanceof ApiError ? failure.status : 0
  const gated = failure instanceof ApiError && status === 403 && failure.code === "gated"
  useEffect(() => {
    if (gated) restart()
  }, [gated, restart])

  const refresh = async () => {
    setRefreshing(true)
    try {
      // A failed refresh keeps the old data on screen, so say why it didn't update.
      const r = await list.refetch()
      if (r.isError) snack({ text: errorText(r.error), error: true })
    } finally {
      setRefreshing(false)
    }
  }

  const loading = (list.isPending && list.fetchStatus !== "idle") || gated
  const filtered = Object.values(filters).some(Boolean)

  const empty = () => {
    if (loading) return <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Loading" style={{ paddingVertical: 64 }} />
    if (failure) {
      if (status === 401)
        return <Centered title="Your session ended" action={<Button label="Sign in again" onPress={restart} />} />
      if (status === 404)
        return (
          <Centered
            title="This folder is gone or you can't see it."
            action={<Button variant="outlined" label="Go back" onPress={() => router.back()} />}
          />
        )
      return <Centered title={failure.message} action={<Button variant="outlined" label="Try again" busy={list.isFetching} onPress={() => list.refetch()} />} />
    }
    if (filtered)
      return <Centered title="Nothing matches these filters." action={<Button variant="outlined" label="Clear filters" onPress={() => setFilters({})} />} />
    const [title, body] = emptyCopy(source)
    return <Centered title={title} body={body} />
  }

  // ---- Header chips ----
  const chip = (key: keyof Filters, name: string, value?: string) => (
    <Chip
      key={key}
      label={name}
      value={value}
      onPress={() => setSheet({ kind: "filter", filter: key })}
      onClear={() => setFilters((f) => ({ ...f, [key]: undefined }))}
    />
  )
  const SortIcon = prefs.order === "asc" ? ArrowUp : ArrowDown
  const sortable = !keepsServerOrder(source)
  const header = (
    <View style={{ gap: 0 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -16 }}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      >
        {chip("type", "Type", filters.type ? FILE_TYPES[filters.type].label : undefined)}
        {chip("modified", isTrash ? "Trashed" : "Modified", filters.modified ? FILTER_LABELS.modified[filters.modified] : undefined)}
        {chip("size", "Size", filters.size ? FILTER_LABELS.size[filters.size] : undefined)}
        {source.kind !== "tag" && !isTrash && chip("tag", "Tags", filters.tag ? tags.get(filters.tag)?.name ?? "Tag" : undefined)}
      </ScrollView>
      {(sortable || !isSearch) && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          {sortable ? (
            <Pressable
              onPress={() => setSheet({ kind: "sort" })}
              android_ripple={{ color: c.ripple }}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${SORTS[prefs.sort].toLowerCase()}, ${prefs.order === "asc" ? "ascending" : "descending"}`}
              style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Text variant="label">{SORTS[prefs.sort]}</Text>
              <SortIcon size={16} color={c.foreground} />
            </Pressable>
          ) : (
            <View />
          )}
          {!isSearch && (
            <IconButton
              icon={prefs.layout === "grid" ? Rows : SquaresFour}
              label={prefs.layout === "grid" ? "Switch to list view" : "Switch to grid view"}
              onPress={() => setPrefs({ layout: prefs.layout === "grid" ? "list" : "grid" })}
            />
          )}
        </View>
      )}
    </View>
  )

  // ---- Top area ----
  const folderName = first?.folder?.name ?? name ?? "Folder"
  const ownTab: TabGroup = role === "owner" ? "(files)" : "(shared)"
  const ancestors = (first?.path ?? []).slice(0, -1)
  const goRoot = () => (tab === ownTab ? router.dismissAll() : router.navigate(homeHref(ownTab)))

  let topArea: ReactNode
  if (selecting) {
    topArea = (
      <Bar>
        <IconButton icon={X} label="Clear selection" onPress={clearSelection} />
        <Text variant="title" style={{ flex: 1 }} numberOfLines={1} accessibilityLiveRegion="polite">
          {selectedIds.size} selected
        </Text>
        {isTrash ? (
          <>
            <IconButton
              icon={ArrowCounterClockwise}
              label="Restore"
              onPress={() => {
                actions.restore(selected)
                clearSelection()
              }}
            />
            <IconButton icon={SelectionAll} label="Select all" onPress={selectAll} />
            <IconButton icon={Trash} label="Delete forever" color={c.destructive} onPress={() => setConfirm("delete")} />
          </>
        ) : (
          <>
            <IconButton
              icon={Star}
              label={selected.every((i) => i.starred) ? "Remove from starred" : "Add to starred"}
              onPress={() => {
                actions.star(selected)
                clearSelection()
              }}
            />
            {editable(selected, role) && (
              <>
                <IconButton icon={ArrowBendUpRight} label="Move" onPress={() => setSheet({ kind: "move", items: selected })} />
                <IconButton
                  icon={Trash}
                  label="Move to trash"
                  color={c.destructive}
                  onPress={() => {
                    actions.trash(selected)
                    clearSelection()
                  }}
                />
              </>
            )}
            <IconButton icon={DotsThreeVertical} label="More actions" onPress={() => setSheet({ kind: "actions", items: selected })} />
          </>
        )}
      </Bar>
    )
  } else if (top) {
    topArea = top
  } else if (source.kind === "folder") {
    topArea = (
      <>
        <Bar>
          <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
          <Text style={[type.title, { flex: 1 }]} numberOfLines={1}>
            {folderName}
          </Text>
          <IconButton icon={MagnifyingGlass} label="Search" onPress={() => router.push("/search")} />
        </Bar>
        {first && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8, alignItems: "center" }} style={{ flexGrow: 0 }}>
            <Crumb first label={role === "owner" ? "My files" : "Shared with me"} onPress={goRoot} />
            {ancestors.map((p) => (
              <Crumb key={p.id} label={p.name} onPress={() => router.dismissTo(folderHref(tab, p.id))} />
            ))}
          </ScrollView>
        )}
      </>
    )
  } else if (isTrash || source.kind === "tag") {
    topArea = (
      <>
        <Bar>
          <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
          {source.kind === "tag" && first?.tag && (
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.tag[first.tag.color] }} />
          )}
          <Text style={[type.title, { flex: 1 }]} numberOfLines={1}>
            {isTrash ? "Trash" : first?.tag?.name ?? "Tag"}
          </Text>
          {isTrash && items.length > 0 && <Button variant="text" danger label="Empty trash" onPress={() => setConfirm("empty")} />}
        </Bar>
        {isTrash && first?.retentionDays != null && (
          <Text variant="bodySmall" color={c.mutedForeground} style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            Items are deleted forever after {first.retentionDays} days.
          </Text>
        )}
      </>
    )
  } else {
    const name = me.data?.name ?? api.account.name
    topArea = (
      <View style={{ paddingTop: inset.top }}>
        <View
          style={{
            marginHorizontal: 16,
            marginTop: 8,
            minHeight: 54,
            flexDirection: "row",
            alignItems: "center",
            borderRadius: radius.pill,
            overflow: "hidden",
            backgroundColor: c.card,
            borderWidth: 1,
            borderColor: c.border,
          }}
        >
          <Pressable
            onPress={() => router.push("/search")}
            android_ripple={{ color: c.ripple }}
            accessibilityRole="search"
            accessibilityLabel="Search in Nimbus"
            style={{ flex: 1, minHeight: 54, flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 16 }}
          >
            <MagnifyingGlass size={22} color={c.mutedForeground} />
            <Text color={c.mutedForeground} numberOfLines={1}>
              Search in Nimbus
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setAccount(true)}
            android_ripple={{ color: c.ripple, borderless: true, radius: 24 }}
            accessibilityRole="button"
            accessibilityLabel={`Account, ${name}, ${serverName(api.account.server)}`}
            style={{ width: 48, height: 48, marginRight: 4, alignItems: "center", justifyContent: "center" }}
          >
            <Avatar account={api.account} name={name} image={me.data ? me.data.image : api.account.image} size={32} />
          </Pressable>
        </View>
        {given.kind === "shared" && (
          <View style={{ flexDirection: "row", marginHorizontal: 16, marginTop: 12, padding: 4, gap: 4, borderRadius: radius.control + 4, backgroundColor: c.muted }}>
            {([[undefined, "With me"], ["me", "By me"]] as const).map(([value, text]) => (
              <Pressable
                key={text}
                onPress={() => setBy(value)}
                android_ripple={{ color: c.ripple }}
                hitSlop={{ top: 4, bottom: 4 }}
                accessibilityRole="button"
                accessibilityLabel={`Shared ${text.toLowerCase()}`}
                accessibilityState={{ selected: by === value }}
                style={{
                  flex: 1,
                  minHeight: 40,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.control,
                  backgroundColor: by === value ? c.mutedStrong : "transparent",
                }}
              >
                <Text variant="label" color={by === value ? c.foreground : c.mutedForeground}>
                  {text}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {topArea}
      <FlatList
        data={failure || loading ? [] : rows}
        renderItem={renderItem}
        keyExtractor={(r) => r.key}
        extraData={selectedIds}
        ListHeaderComponent={failure ? undefined : header}
        ListEmptyComponent={<>{empty()}</>}
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={c.mutedForeground} style={{ padding: 16 }} /> : undefined}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        onEndReachedThreshold={0.5}
        onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[c.foreground]} progressBackgroundColor={c.muted} />
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: showFab ? 96 : 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />

      {showFab && (
        <Fab
          label="New"
          icon={<Plus size={24} color={c.primaryForeground} />}
          extended={grown}
          onPress={() => setSheet({ kind: "new", parentId: source.kind === "folder" ? source.id : null })}
        />
      )}

      <FileSheets
        sheet={sheet}
        onChange={setSheet}
        role={role}
        trash={isTrash}
        tags={first?.tags ?? []}
        filters={filters}
        onFilters={setFilters}
        tagFilter={source.kind !== "tag"}
        sortable={sortable}
        onOpen={open}
        onSelectAll={selecting ? selectAll : undefined}
        onDone={clearSelection}
      />

      {account && <AccountSheet onClose={() => setAccount(false)} />}

      {confirm === "empty" && (
        <ConfirmDialog
          title="Empty the trash?"
          body="Everything in the trash is deleted forever. You can't undo this."
          confirm="Empty trash"
          onConfirm={() => actions.emptyTrash()}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === "delete" && (
        <ConfirmDialog
          title="Delete forever?"
          body={`${itemsLabel(selected)} will be deleted forever. You can't undo this.`}
          confirm="Delete forever"
          onConfirm={() => {
            actions.remove(selected)
            clearSelection()
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </View>
  )
}

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
        <Text variant="bodySmall" color={c.mutedForeground}>
          {label}
        </Text>
      </Pressable>
    </View>
  )
}
