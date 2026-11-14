import type { DocumentItem } from "@nimbus/shared/documents-api"
import { useQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import {
  ArrowLeft,
  CalendarBlank,
  CheckCircle,
  CurrencyDollar,
  FileDashed,
  FilePlus,
  GearSix,
  Hourglass,
  MagnifyingGlass,
  Rows,
  Scan,
  SortAscending,
  SquaresFour,
  Tag,
  DownloadSimple,
  UploadSimple,
  UserCircle,
  Warning,
  X,
} from "phosphor-react-native"
import { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, BackHandler, FlatList, Pressable, RefreshControl, ScrollView, TextInput, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { PromptDialog } from "@/components/dialog"
import { DocCard, DocFilterSheet, DocRow, Chip, Segments, TONE, TotalsList, type FilterSheet } from "@/components/documents-ui"
import { usePhotoSheet } from "@/components/photo-sheets"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { useSnack } from "@/components/snackbar"
import { Bar, Button, Fab, IconButton, Spinner, Text } from "@/components/ui"
import { useUploader } from "@/components/uploader"
import { errorText } from "@/lib/api"
import { useDocActions, useDocSenders, useDocSummary, useDocTotals, useDocTypes, useDocs } from "@/lib/documents"
import { NO_FILTERS, expiryInfo, filterCount, toItem, type DocFilters } from "@/lib/documents-rules"
import { useApi } from "@/lib/files"
import { native } from "@/lib/native"
import { useQueue } from "@/lib/offline-queue"
import { openPreview } from "@/lib/preview-session"
import { useTransfers } from "@/lib/transfers"
import { pick } from "@/lib/uploads"
import type { Entry } from "@/lib/upload-plan"
import { c, type } from "@/lib/theme"

type Tab = "all" | "review" | "totals"
const GAP = 12

// Documents: the files Nimbus found to be documents, with their facts, and a way to sort them out.
export default function Documents() {
  const inset = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const api = useApi()
  const snack = useSnack()
  const actions = useDocActions()
  const transfers = useTransfers()
  const { send, scan } = useUploader()
  const pending = useQueue(api.id).pending
  const summary = useDocSummary()
  const types = useDocTypes()
  const senders = useDocSenders()
  const sheets = usePhotoSheet()

  const [tab, setTab] = useState<Tab>("all")
  const [dismissed, setDismissed] = useState(false)
  const [filters, setFilters] = useState<DocFilters>(NO_FILTERS)
  const [search, setSearch] = useState<string | null>(null)
  const [layout, setLayout] = useState<"list" | "grid">("list")
  const [sheet, setSheet] = useState<FilterSheet | null>(null)
  const [selected, setSelected] = useState<DocumentItem[]>([])
  const [bulk, setBulk] = useState<"type" | "sender" | "add" | "more" | null>(null)
  const [naming, setNaming] = useState(false)
  const [busy, setBusy] = useState(false)
  const selecting = selected.length > 0
  const canScan = useQuery({ queryKey: ["scanAvailable"], queryFn: () => native?.scanAvailable() ?? false, staleTime: Infinity }).data

  // The tabs and the Not a document list are the status filter; the rest is what the chips hold.
  const query: DocFilters = { ...filters, q: search ?? "", status: dismissed ? "dismissed" : tab === "review" ? "review" : undefined }
  const list = useDocs(query, tab !== "totals")
  const [year, setYear] = useState<number | undefined>()
  const [by, setBy] = useState<"sender" | "type">("sender")
  const [period, setPeriod] = useState<"month" | "year">("month")
  const totals = useDocTotals({ by, period, year }, tab === "totals")

  // The Android back button leaves selection first, then search.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selecting) return setSelected([]), true
      if (search !== null) return setSearch(null), true
      return false
    })
    return () => sub.remove()
  }, [selecting, search])

  const active = filterCount(filters)
  const items = list.items
  const flat = tab === "all" && !dismissed && !active && search === null

  const open = useCallback(
    (d: DocumentItem) => {
      if (selecting) return setSelected((s) => (s.some((x) => x.id === d.id) ? s.filter((x) => x.id !== d.id) : [...s, d]))
      openPreview({
        items: items.map(toItem),
        index: items.findIndex((x) => x.id === d.id),
        role: d.role,
        more: async () => {
          if (!list.hasNextPage) return null
          const next = await list.fetchNextPage()
          return next.data?.pages.flatMap((p) => p.items).map(toItem) ?? null
        },
      })
    },
    [selecting, items, list]
  )
  const toggle = useCallback((d: DocumentItem) => setSelected((s) => (s.some((x) => x.id === d.id) ? s.filter((x) => x.id !== d.id) : [...s, d])), [])
  const menu = useCallback((d: DocumentItem) => sheets.show(toItem(d)), [sheets])

  const mine = selected.filter((d) => d.role === "owner")
  const ids = mine.map((d) => d.id)
  const need = () => {
    if (!mine.length) snack({ text: "Documents shared with you can't be changed.", error: true })
    return mine.length > 0
  }
  const done = (text?: string) => {
    setSelected([])
    if (text) snack({ text })
  }
  const run = async (task: () => Promise<string | void>, text: string) => {
    setBusy(true)
    const err = await task()
    setBusy(false)
    if (err) snack({ text: err, error: true })
    else done(text)
  }

  const add = async (files: () => Promise<Entry[]>) => {
    try {
      const entries = await files()
      if (!entries.length) return
      const target = await actions.uploadTarget()
      if (await send(api.account, target.folderId, entries)) snack({ text: `Added to ${target.path}. New files show up in Needs review shortly.` })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }

  const cols = layout === "grid" ? Math.max(2, Math.floor((width - 32 + GAP) / (170 + GAP))) : 1
  const cell = (width - 32 - GAP * (cols - 1)) / cols
  const review = summary.data?.review ?? 0

  const header = (
    <View>
      {flat && summary.data && summary.data.expiring.length > 0 && (
        <View style={{ paddingTop: 4, paddingBottom: 8 }}>
          <Text variant="label" color={c.mutedForeground} style={{ paddingHorizontal: 16, paddingBottom: 8 }}>Expiring soon</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
            {summary.data.expiring.map((d) => {
              const e = expiryInfo(d)
              return (
                <Pressable
                  key={d.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.name}. ${e?.text ?? ""}`}
                  android_ripple={{ color: c.ripple }}
                  onPress={() => router.push({ pathname: "/documents/[id]", params: { id: d.id } })}
                  style={{ width: 200, minHeight: 64, padding: 12, gap: 2, borderRadius: 12, borderWidth: 1, borderColor: c.border, overflow: "hidden" }}
                >
                  <Text variant="label" numberOfLines={1} ellipsizeMode="middle">{d.typeName ?? d.name}</Text>
                  <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>{d.senderName ?? d.name}</Text>
                  {e && <Text variant="caption" color={TONE[e.tone]}>{e.text}</Text>}
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      )}
    </View>
  )

  const empty = list.isPending ? undefined : (
    <View style={{ alignItems: "center", paddingVertical: 56, paddingHorizontal: 24, gap: 8 }}>
      <FileDashed size={40} color={c.mutedForeground} />
      <Text variant="titleSmall" style={{ textAlign: "center" }}>
        {dismissed ? "Nothing is marked as not a document" : tab === "review" && !active && search === null ? "Nothing to review" : active || search ? "No documents match" : "No documents yet"}
      </Text>
      <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>
        {dismissed
          ? "Files you mark as not a document wait here, in case you change your mind."
          : active || search
            ? "Try fewer filters or other words."
            : tab === "review"
              ? "Everything Nimbus found has been checked."
              : "PDFs, scans and receipts are found in the background. Scan one to start."}
      </Text>
      {(active > 0 || !!search) && <Button variant="outlined" label="Clear filters" onPress={() => (setFilters(NO_FILTERS), setSearch(null))} />}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {selecting ? (
        <Bar>
          <IconButton icon={X} label="Clear selection" onPress={() => setSelected([])} />
          <Text variant="title" style={{ flex: 1, fontVariant: ["tabular-nums"] }}>{selected.length} selected</Text>
          <IconButton icon={CheckCircle} label="Select all loaded" onPress={() => setSelected(items)} />
        </Bar>
      ) : search !== null ? (
        <Bar>
          <IconButton icon={ArrowLeft} label="Close search" onPress={() => setSearch(null)} />
          <SearchField value={search} onChange={setSearch} />
        </Bar>
      ) : (
        <Bar>
          <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text variant="title" numberOfLines={1} accessibilityRole="header">{dismissed ? "Not a document" : "Documents"}</Text>
            {tab !== "totals" && list.total > 0 && <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{list.total.toLocaleString()} {list.total === 1 ? "document" : "documents"}</Text>}
          </View>
          <IconButton icon={MagnifyingGlass} label="Search documents" onPress={() => setSearch("")} />
          {tab !== "totals" && <IconButton icon={layout === "grid" ? Rows : SquaresFour} label={layout === "grid" ? "Show as list" : "Show as grid"} onPress={() => setLayout(layout === "grid" ? "list" : "grid")} />}
          <IconButton icon={GearSix} label="Document settings" onPress={() => router.push("/documents/settings")} />
        </Bar>
      )}

      {!selecting && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
          <Segments
            value={dismissed ? "all" : tab}
            options={[{ value: "all", label: "All" }, { value: "review", label: review ? `Needs review · ${review}` : "Needs review" }, { value: "totals", label: "Totals" }]}
            onChange={(t) => (setDismissed(false), setTab(t))}
          />
        </View>
      )}

      {tab === "totals" && !dismissed ? (
        <>
          <View style={{ padding: 16, gap: 8 }}>
            <Segments value={by} options={[{ value: "sender", label: "By sender" }, { value: "type", label: "By type" }]} onChange={setBy} />
            <Segments value={period} options={[{ value: "month", label: "Per month" }, { value: "year", label: "Per year" }]} onChange={setPeriod} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
              {[undefined, ...Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i)].map((y) => (
                <Pressable
                  key={y ?? "all"}
                  accessibilityRole="button"
                  accessibilityState={{ selected: year === y }}
                  onPress={() => setYear(y)}
                  style={{ height: 36, paddingHorizontal: 14, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: year === y ? c.brand : c.input, backgroundColor: year === y ? c.brandWash : "transparent" }}
                >
                  <Text variant="label">{y ?? "All years"}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          {totals.isPending ? <Spinner /> : totals.error && !totals.data ? <Failed message={totals.error.message} busy={totals.isFetching} retry={() => totals.refetch()} /> : <TotalsList rows={totals.data ?? []} />}
        </>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
            <Chip label={filters.type ? (types.data?.find((t) => t.id === filters.type)?.name ?? "Type") : "Type"} icon={Tag} on={!!filters.type} onPress={() => setSheet("type")} />
            <Chip label={filters.sender ? (senders.data?.find((s) => s.id === filters.sender)?.name ?? "Sender") : "Sender"} icon={UserCircle} on={!!filters.sender} onPress={() => setSheet("sender")} />
            <Chip label={filters.year ? String(filters.year) : filters.from || filters.to ? "Date range" : "Date"} icon={CalendarBlank} on={!!(filters.year || filters.from || filters.to)} onPress={() => setSheet("date")} />
            <Chip label="Amount" icon={CurrencyDollar} on={!!(filters.minAmount || filters.maxAmount)} onPress={() => setSheet("amount")} />
            <Chip label={filters.expiring ? ({ soon: "Expiring soon", expired: "Expired", any: "Has expiry" }[filters.expiring]) : "Expiry"} icon={Hourglass} on={!!filters.expiring} onPress={() => setSheet("expiring")} />
            <Chip label={filters.missing.length ? `Missing ${filters.missing.length}` : "Missing"} icon={Warning} on={filters.missing.length > 0} onPress={() => setSheet("missing")} />
            <Chip label="Sort" icon={SortAscending} onPress={() => setSheet("sort")} />
          </ScrollView>
          {list.isPending ? (
            <Spinner />
          ) : list.isError && !items.length ? (
            <Failed message={(list.error as Error).message} busy={list.isFetching} retry={() => list.refetch()} />
          ) : (
            <FlatList
              key={cols}
              data={items}
              numColumns={cols}
              keyExtractor={(d) => d.id}
              ListHeaderComponent={header}
              ListEmptyComponent={empty}
              columnWrapperStyle={cols > 1 ? { gap: GAP, paddingHorizontal: 16, marginBottom: GAP } : undefined}
              contentContainerStyle={{ paddingBottom: inset.bottom + 112, flexGrow: 1 }}
              onEndReachedThreshold={0.6}
              onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
              refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void (list.refetch(), summary.refetch())} tintColor={c.mutedForeground} colors={[c.brand]} progressBackgroundColor={c.card} />}
              ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={c.mutedForeground} style={{ padding: 16 }} accessibilityLabel="Loading more" /> : undefined}
              renderItem={({ item: d }) => {
                const p = { d, selecting, selected: selected.some((x) => x.id === d.id), pending: pending.has(d.id), onPress: open, onLongPress: toggle, onMenu: menu }
                return cols > 1 ? <View style={{ width: cell }}><DocCard {...p} /></View> : <DocRow {...p} />
              }}
            />
          )}
        </>
      )}

      {!selecting && tab !== "totals" && <Fab label="Add" icon={<FilePlus size={24} color={c.primaryForeground} />} style={{ bottom: inset.bottom + 16 }} onPress={() => setBulk("add")} />}

      {selecting && (
        <View style={{ borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card, paddingBottom: inset.bottom }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8, gap: 4 }}>
            <Action label="Type" icon={Tag} onPress={() => need() && setBulk("type")} />
            <Action label="Sender" icon={UserCircle} onPress={() => need() && setBulk("sender")} />
            <Action label="Confirm" icon={CheckCircle} busy={busy} onPress={() => need() && run(() => actions.bulk({ ids, confirm: true }), `Confirmed ${ids.length}.`)} />
            <Action label="Merge to PDF" icon={FilePlus} onPress={() => selected.filter((d) => d.role === "owner").length > 1 ? setNaming(true) : snack({ text: "Pick two or more files to merge.", error: true })} />
            <Action label="Download" icon={DownloadSimple} onPress={() => { transfers.download(selected.map(toItem)); setSelected([]) }} />
            <Action label="More" icon={GearSix} onPress={() => setBulk("more")} />
          </ScrollView>
        </View>
      )}

      {sheet && <DocFilterSheet which={sheet} filters={filters} onChange={setFilters} onClose={() => setSheet(null)} />}

      {bulk === "type" && (
        <Sheet onClose={() => setBulk(null)}>
          <SheetRow label="No type" onPress={() => run(() => actions.bulk({ ids, typeId: null }), "Type cleared.")} />
          {(types.data ?? []).map((t) => <SheetRow key={t.id} label={t.name} onPress={() => run(() => actions.bulk({ ids, typeId: t.id }), `Set to ${t.name}.`)} />)}
        </Sheet>
      )}
      {bulk === "sender" && (
        <Sheet onClose={() => setBulk(null)}>
          <SheetRow label="No sender" onPress={() => run(() => actions.bulk({ ids, senderId: null }), "Sender cleared.")} />
          {(senders.data ?? []).map((s) => <SheetRow key={s.id} label={s.name} onPress={() => run(() => actions.bulk({ ids, senderId: s.id }), `Sender set to ${s.name}.`)} />)}
        </Sheet>
      )}
      {bulk === "more" && (
        <Sheet onClose={() => setBulk(null)}>
          <SheetRow label="Not a document" detail="Hide them from Documents. The files stay where they are." needsNet icon={<FileDashed size={24} color={c.mutedForeground} />} onPress={() => need() && run(() => actions.mark(ids, false), "Marked as not a document.")} />
        </Sheet>
      )}
      {bulk === "add" && (
        <Sheet onClose={() => setBulk(null)}>
          {canScan && <SheetRow label="Scan a document" detail="Pages become one PDF" needsNet icon={<Scan size={24} color={c.mutedForeground} />} onPress={() => add(scan)} />}
          <SheetRow label="Upload files" needsNet icon={<UploadSimple size={24} color={c.mutedForeground} />} onPress={() => add(pick.files)} />
          <SheetDivider />
          <SheetRow label={dismissed ? "Back to documents" : "Not a document list"} detail={dismissed ? undefined : "Files you hid, to bring back"} icon={<FileDashed size={24} color={c.mutedForeground} />} onPress={() => { setDismissed(!dismissed); setTab("all") }} />
        </Sheet>
      )}
      {naming && (
        <PromptDialog
          title="Merge into one PDF"
          label="Name (optional)"
          confirm="Merge"
          canSubmit={() => true}
          onClose={() => setNaming(false)}
          onSubmit={async (name) => {
            try {
              const r = await actions.merge(selected.filter((d) => d.role === "owner").map((d) => d.id), name || undefined)
              actions.refresh()
              done(`Made ${r.name} in Documents.`)
            } catch (e) {
              return errorText(e)
            }
          }}
        />
      )}
      {sheets.element}
    </View>
  )
}

function Failed({ message, busy, retry }: { message: string; busy: boolean; retry: () => void }) {
  return (
    <View style={{ alignItems: "center", padding: 24, gap: 12 }}>
      <Text variant="bodySmall" color={c.mutedForeground} style={{ textAlign: "center" }}>{message}</Text>
      <Button variant="outlined" label="Try again" busy={busy} onPress={retry} />
    </View>
  )
}

function Action({ label, icon: I, onPress, busy }: { label: string; icon: typeof Tag; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: c.ripple }}
      onPress={onPress}
      disabled={busy}
      style={{ minWidth: 72, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 2, paddingHorizontal: 8, borderRadius: 12, opacity: busy ? 0.5 : 1 }}
    >
      {busy ? <ActivityIndicator size="small" color={c.foreground} /> : <I size={22} color={c.foreground} />}
      <Text variant="caption" numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flex: 1, height: 44, marginRight: 8, flexDirection: "row", alignItems: "center", borderRadius: 999, borderWidth: 1, borderColor: c.input, paddingHorizontal: 14 }}>
      <TextFieldInput value={value} onChange={onChange} />
    </View>
  )
}

function TextFieldInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      autoFocus
      accessibilityLabel="Search documents"
      placeholder="Search type, sender, text…"
      placeholderTextColor={c.mutedForeground}
      selectionColor={c.brand}
      cursorColor={c.brand}
      returnKeyType="search"
      style={[type.body, { flex: 1, color: c.foreground, padding: 0 }]}
    />
  )
}
