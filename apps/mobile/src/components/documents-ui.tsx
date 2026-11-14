import type { DocField, DocumentItem, DocumentsTotalRow } from "@nimbus/shared/documents-api"
import { formatBytes } from "@nimbus/shared/file-rules"
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker"
import { Image } from "expo-image"
import { CaretDown, CheckCircle, Clock, DotsThreeVertical, UsersThree, type Icon } from "phosphor-react-native"
import { useState, type ReactNode } from "react"
import { Pressable, ScrollView, View } from "react-native"
import { useReducedMotion } from "react-native-reanimated"

import { FileIcon } from "@/components/file-icon"
import { Sheet, SheetDivider, SheetRow } from "@/components/sheet"
import { Button, Field, Text } from "@/components/ui"
import { useDocSenders, useDocTypes } from "@/lib/documents"
import {
  EXPIRING_LABEL,
  MISSING_LABEL,
  SORT_LABEL,
  dayText,
  expiryInfo,
  money,
  parseAmount,
  toItem,
  ymd,
  type DocFilters,
  type DocSort,
  type Tone,
} from "@/lib/documents-rules"
import { useApi } from "@/lib/files"
import { c, radius } from "@/lib/theme"

export const TONE: Record<Tone, string> = { danger: c.destructive, warn: c.warning, muted: c.mutedForeground }
const NUM = { fontVariant: ["tabular-nums" as const] }

// ---- One document ----

function DocThumb({ d, size, fill }: { d: DocumentItem; size: number; fill?: boolean }) {
  const { account } = useApi()
  const still = useReducedMotion()
  if (!d.thumb || !d.version) return <FileIcon item={toItem(d)} size={fill ? 40 : 28} />
  return (
    <Image
      source={{ uri: `${account.server}/api/files/${d.id}/thumb?v=${d.version}&r=${d.thumb}`, headers: { authorization: `Bearer ${account.token}` } }}
      style={fill ? { width: "100%", height: "100%" } : { width: size, height: size }}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={d.id}
      transition={still ? 0 : 120}
      accessibilityIgnoresInvertColors
    />
  )
}

export type DocTileProps = {
  d: DocumentItem
  selecting: boolean
  selected: boolean
  pending: boolean
  onPress: (d: DocumentItem) => void
  onLongPress: (d: DocumentItem) => void
  onMenu: (d: DocumentItem) => void
}

// Type, sender, date and amount: the facts a document is found by, on two short lines.
function facts(d: DocumentItem) {
  const who = [d.typeName, d.role === "viewer" ? `From ${d.owner ?? "someone"}` : d.senderName].filter(Boolean).join(" · ")
  const when = [d.docDate && dayText(d.docDate), money(d.amount, d.currency)].filter(Boolean).join(" · ")
  return { who: who || "No type or sender", when }
}

const Check = ({ on }: { on: boolean }) =>
  on ? <CheckCircle size={22} weight="fill" color={c.brand} /> : <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.mutedForeground }} />

function Status({ d, pending }: { d: DocumentItem; pending: boolean }) {
  const exp = expiryInfo(d)
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {d.status === "review" && <Text variant="caption" color={c.warning}>Needs review</Text>}
      {exp && exp.tone !== "muted" && <Text variant="caption" color={TONE[exp.tone]}>{exp.text}</Text>}
      {d.dupOf && <Text variant="caption" color={c.mutedForeground}>Possible duplicate</Text>}
      {d.role === "viewer" && <UsersThree size={14} color={c.mutedForeground} />}
      {pending && <Clock size={14} color={c.warning} />}
    </View>
  )
}

function MenuButton({ d, onMenu }: { d: DocumentItem; onMenu: (d: DocumentItem) => void }) {
  return (
    <View style={{ borderRadius: 24, overflow: "hidden" }}>
      <Pressable
        onPress={() => onMenu(d)}
        android_ripple={{ color: c.ripple }}
        accessibilityRole="button"
        accessibilityLabel={`More actions for ${d.name}`}
        style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
      >
        <DotsThreeVertical size={22} weight="bold" color={c.mutedForeground} />
      </Pressable>
    </View>
  )
}

function Frame({ p, outlined, children }: { p: DocTileProps; outlined: boolean; children: ReactNode }) {
  const { d } = p
  const { who, when } = facts(d)
  return (
    <View
      style={{
        ...(outlined ? { flex: 1, minWidth: 0 } : {}),
        borderRadius: outlined ? radius.card : 0,
        overflow: "hidden",
        borderWidth: outlined ? 1 : 0,
        borderColor: p.selected ? c.brand : c.border,
        backgroundColor: p.selected ? c.brandWash : "transparent",
      }}
    >
      <Pressable
        onPress={() => p.onPress(d)}
        onLongPress={() => p.onLongPress(d)}
        android_ripple={{ color: c.ripple }}
        accessibilityRole={p.selecting ? "checkbox" : "button"}
        accessibilityLabel={`${d.name}. ${who}${when ? `. ${when}` : ""}${d.status === "review" ? ". Needs review" : ""}${p.pending ? ". Waiting to sync" : ""}`}
        accessibilityState={p.selecting ? { checked: p.selected } : { selected: p.selected }}
      >
        {children}
      </Pressable>
    </View>
  )
}

export function DocRow(p: DocTileProps) {
  const { d } = p
  const { who, when } = facts(d)
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
      <Frame p={p} outlined={false}>
        <View style={{ flexDirection: "row", alignItems: "center", minHeight: 72, paddingLeft: 12, paddingRight: p.selecting ? 12 : 0, gap: 12 }}>
          {p.selecting && <Check on={p.selected} />}
          <View style={{ width: 44, height: 44, borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: c.card }}>
            <DocThumb d={d} size={44} />
          </View>
          <View style={{ flex: 1, minWidth: 0, paddingVertical: 8, gap: 2 }}>
            <Text variant="label" numberOfLines={1} ellipsizeMode="middle">{d.name}</Text>
            <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>{who}</Text>
            {!!when && <Text variant="caption" color={c.mutedForeground} numberOfLines={1} style={NUM}>{when}</Text>}
            <Status d={d} pending={p.pending} />
          </View>
          {!p.selecting && <MenuButton d={d} onMenu={p.onMenu} />}
        </View>
      </Frame>
    </View>
  )
}

export function DocCard(p: DocTileProps) {
  const { d } = p
  const { who, when } = facts(d)
  return (
    <Frame p={p} outlined>
      <View style={{ aspectRatio: 4 / 3, backgroundColor: c.card, alignItems: "center", justifyContent: "center" }}>
        <DocThumb d={d} size={0} fill />
      </View>
      <View style={{ paddingLeft: 12, paddingBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingRight: p.selecting ? 12 : 0 }}>
          {p.selecting && <Check on={p.selected} />}
          <Text variant="label" numberOfLines={1} ellipsizeMode="middle" style={{ flex: 1 }}>{d.name}</Text>
          {!p.selecting && <MenuButton d={d} onMenu={p.onMenu} />}
        </View>
        <View style={{ marginTop: -8, paddingRight: 12, gap: 2 }}>
          <Text variant="caption" color={c.mutedForeground} numberOfLines={1}>{who}</Text>
          <Text variant="caption" color={c.mutedForeground} numberOfLines={1} style={NUM}>{when || formatBytes(d.size)}</Text>
          <Status d={d} pending={p.pending} />
        </View>
      </View>
    </Frame>
  )
}

// ---- Filter chips ----

export function Chip({ label, on, icon: I, onPress }: { label: string; on?: boolean; icon?: Icon; onPress: () => void }) {
  return (
    <View style={{ minHeight: 48, justifyContent: "center" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: !!on }}
        android_ripple={{ color: c.ripple }}
        hitSlop={{ top: 6, bottom: 6 }}
        onPress={onPress}
        style={{
          height: 36,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 14,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: on ? c.brand : c.input,
          backgroundColor: on ? c.brandWash : "transparent",
        }}
      >
        {I && <I size={18} color={on ? c.brand : c.mutedForeground} />}
        <Text variant="label" numberOfLines={1}>{label}</Text>
        <CaretDown size={14} color={c.mutedForeground} />
      </Pressable>
    </View>
  )
}

// Two or three choices side by side.
export function Segments<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: "row", borderWidth: 1, borderColor: c.input, borderRadius: radius.pill, padding: 3, gap: 2 }}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="button"
          accessibilityState={{ selected: o.value === value }}
          onPress={() => onChange(o.value)}
          style={{ flexGrow: 1, flexShrink: 1, paddingHorizontal: 8, minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: o.value === value ? c.muted : "transparent" }}
        >
          <Text variant="label" numberOfLines={1} color={o.value === value ? c.foreground : c.mutedForeground}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

// ---- Date picking ----

// Android's own calendar; `onPick(null)` clears.
export function pickDay(current: string | null, onPick: (ymd: string) => void) {
  const [y, m, d] = (current ?? ymd(new Date())).split("-").map(Number)
  DateTimePickerAndroid.open({ mode: "date", value: new Date(y, m - 1, d), onValueChange: (_, date) => date && onPick(ymd(date)) })
}

export function DateField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${value ? dayText(value) : "not set"}. Change`}
          android_ripple={{ color: c.ripple }}
          onPress={() => pickDay(value, onChange)}
          style={{ flex: 1, minHeight: 52, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.control, borderWidth: 1, borderColor: c.input }}
        >
          <Text color={value ? c.foreground : c.mutedForeground}>{value ? dayText(value) : "Not set"}</Text>
        </Pressable>
        {value && <Button variant="outlined" label="Clear" onPress={() => onChange(null)} />}
      </View>
    </View>
  )
}

// ---- Filter sheets ----

export type FilterSheet = "type" | "sender" | "date" | "amount" | "expiring" | "missing" | "sort"

const Title = ({ children }: { children: string }) => (
  <Text variant="titleSmall" accessibilityRole="header" style={{ paddingHorizontal: 20, paddingBottom: 8 }}>{children}</Text>
)

export function DocFilterSheet({ which, filters, onChange, onClose }: { which: FilterSheet; filters: DocFilters; onChange: (f: DocFilters) => void; onClose: () => void }) {
  const types = useDocTypes()
  const senders = useDocSenders()
  const [min, setMin] = useState(filters.minAmount ?? "")
  const [max, setMax] = useState(filters.maxAmount ?? "")
  const [cur, setCur] = useState(filters.currency ?? "")
  const set = (patch: Partial<DocFilters>) => onChange({ ...filters, ...patch })
  const year = new Date().getFullYear()

  if (which === "type")
    return (
      <Sheet onClose={onClose} header={<Title>Type</Title>}>
        <SheetRow label="Any type" selected={!filters.type} onPress={() => set({ type: undefined })} />
        {(types.data ?? []).map((t) => <SheetRow key={t.id} label={t.name} selected={filters.type === t.id} onPress={() => set({ type: t.id })} />)}
        {types.isPending && <Text color={c.mutedForeground} style={{ padding: 20 }}>Loading</Text>}
        {types.isError && <Text color={c.destructive} style={{ padding: 20 }}>{types.error.message}</Text>}
      </Sheet>
    )
  if (which === "sender")
    return (
      <Sheet onClose={onClose} header={<Title>Sender</Title>}>
        <SheetRow label="Any sender" selected={!filters.sender} onPress={() => set({ sender: undefined })} />
        {(senders.data ?? []).map((s) => <SheetRow key={s.id} label={s.name} detail={`${s.count} ${s.count === 1 ? "document" : "documents"}`} selected={filters.sender === s.id} onPress={() => set({ sender: s.id })} />)}
        {senders.isPending && <Text color={c.mutedForeground} style={{ padding: 20 }}>Loading</Text>}
        {senders.isError && <Text color={c.destructive} style={{ padding: 20 }}>{senders.error.message}</Text>}
      </Sheet>
    )
  if (which === "date")
    return (
      <Sheet onClose={onClose} header={<Title>Document date</Title>}>
        <SheetRow label="Any date" selected={!filters.year && !filters.from && !filters.to} onPress={() => set({ year: undefined, from: undefined, to: undefined })} />
        {Array.from({ length: 8 }, (_, i) => year - i).map((y) => (
          <SheetRow key={y} label={String(y)} selected={filters.year === y} onPress={() => set({ year: y, from: undefined, to: undefined })} />
        ))}
        <SheetDivider />
        <SheetRow label="From" detail={filters.from ? dayText(filters.from) : "Pick a day"} stay onPress={() => pickDay(filters.from ?? null, (v) => set({ from: v, year: undefined }))} />
        <SheetRow label="To" detail={filters.to ? dayText(filters.to) : "Pick a day"} stay onPress={() => pickDay(filters.to ?? null, (v) => set({ to: v, year: undefined }))} />
      </Sheet>
    )
  if (which === "expiring")
    return (
      <Sheet onClose={onClose} header={<Title>Expiry</Title>}>
        <SheetRow label="Any" selected={!filters.expiring} onPress={() => set({ expiring: undefined })} />
        {(Object.keys(EXPIRING_LABEL) as (keyof typeof EXPIRING_LABEL)[]).map((k) => (
          <SheetRow key={k} label={EXPIRING_LABEL[k]} selected={filters.expiring === k} onPress={() => set({ expiring: k })} />
        ))}
      </Sheet>
    )
  if (which === "missing")
    return (
      <Sheet onClose={onClose} header={<Title>Missing fields</Title>}>
        {(Object.keys(MISSING_LABEL) as DocField[]).map((k) => {
          const on = filters.missing.includes(k)
          return (
            <SheetRow
              key={k}
              stay
              label={MISSING_LABEL[k]}
              selected={on}
              trailing={on ? <CheckCircle size={22} weight="fill" color={c.brand} /> : undefined}
              onPress={() => set({ missing: on ? filters.missing.filter((m) => m !== k) : [...filters.missing, k] })}
            />
          )
        })}
      </Sheet>
    )
  if (which === "sort")
    return (
      <Sheet onClose={onClose} header={<Title>Sort by</Title>}>
        {(Object.keys(SORT_LABEL) as DocSort[]).map((k) => (
          <SheetRow key={k} stay selected={filters.sort === k} label={SORT_LABEL[k]} trailing={filters.sort === k ? <CheckCircle size={22} weight="fill" color={c.brand} /> : undefined} onPress={() => set({ sort: k })} />
        ))}
        <SheetDivider />
        <View style={{ padding: 20 }}>
          <Segments value={filters.order} options={[{ value: "desc", label: "Newest first" }, { value: "asc", label: "Oldest first" }]} onChange={(order) => set({ order })} />
        </View>
      </Sheet>
    )
  const bad = (min && parseAmount(min) === null) || (max && parseAmount(max) === null) || (cur && !/^[A-Za-z]{3}$/.test(cur))
  return (
    <Sheet
      onClose={onClose}
      header={<Title>Amount</Title>}
      footer={
        <View style={{ paddingHorizontal: 20, paddingTop: 8, flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="text" label="Clear" onPress={() => { set({ minAmount: undefined, maxAmount: undefined, currency: undefined }); onClose() }} />
          <Button label="Apply" disabled={!!bad} onPress={() => { set({ minAmount: min || undefined, maxAmount: max || undefined, currency: cur ? cur.toUpperCase() : undefined }); onClose() }} />
        </View>
      }
    >
      <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 12 }}>
        <Field label="At least" value={min} onChangeText={setMin} keyboardType="decimal-pad" placeholder="0" />
        <Field label="At most" value={max} onChangeText={setMax} keyboardType="decimal-pad" placeholder="No limit" />
        <Field label="Currency" value={cur} onChangeText={setCur} autoCapitalize="characters" maxLength={3} placeholder="Any, or USD" error={cur && !/^[A-Za-z]{3}$/.test(cur) ? "Use a three letter code." : null} />
      </View>
    </Sheet>
  )
}

// ---- Totals ----

// Per period, then per sender or type; each currency on its own line, never added together.
export function TotalsList({ rows }: { rows: DocumentsTotalRow[] }) {
  const periods = [...new Set(rows.map((r) => r.period))].sort().reverse()
  if (!rows.length)
    return (
      <View style={{ padding: 24, gap: 4 }}>
        <Text variant="titleSmall">No amounts yet</Text>
        <Text variant="bodySmall" color={c.mutedForeground}>Totals add up the amounts on confirmed documents.</Text>
      </View>
    )
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
      {periods.map((p) => (
        <View key={p}>
          <Text variant="label" accessibilityRole="header" color={c.mutedForeground} style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 6 }}>
            {periodText(p)}
          </Text>
          {rows.filter((r) => r.period === p).map((r) => (
            <View key={`${r.key}-${r.currency}`} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: c.border }}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1}>{r.label}</Text>
                <Text variant="caption" color={c.mutedForeground}>{r.count} {r.count === 1 ? "document" : "documents"}</Text>
              </View>
              <Text style={NUM}>{money(r.total, r.currency)}</Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  )
}

function periodText(p: string) {
  const [y, m] = p.split("-").map(Number)
  return m ? new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : String(y)
}
