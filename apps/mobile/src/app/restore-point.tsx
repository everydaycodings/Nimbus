import type { RestoreApplyResponse, RestoreGroups, RestoreItem, RestorePreviewResponse, RestoreUndoResponse, RestoreWindowResponse } from "@nimbus/shared/api"
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker"
import { useQuery } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import { CalendarBlank } from "phosphor-react-native"
import { useState } from "react"
import { Pressable, View } from "react-native"

import { Group, Page, Row, Section } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, Spinner, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi, useFileActions } from "@/lib/files"
import { c, radius } from "@/lib/theme"

const HOUR = 36e5
const PRESETS = [
  { label: "1 hour ago", ms: HOUR },
  { label: "Yesterday", ms: 24 * HOUR },
  { label: "1 week ago", ms: 7 * 24 * HOUR },
  { label: "30 days ago", ms: 30 * 24 * HOUR },
]
const GROUPS = [
  ["trash", "Back from Trash"],
  ["versions", "Older versions"],
  ["renames", "Renamed back"],
  ["moves", "Moved back"],
  ["blocked", "Can’t restore"],
] as const
const SHOWN = 8
const mute = c.mutedForeground
const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`
const total = (g: RestoreGroups) => g.trash.length + g.versions.length + g.renames.length + g.moves.length

// Puts a folder back the way it was at a chosen time: pick a time, read what would change, restore.
export default function RestorePoint() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const api = useApi()
  const actions = useFileActions()
  const snack = useSnack()
  const [at, setAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [now] = useState(Date.now)

  const win = useQuery({
    queryKey: [api.id, "restore-window", id],
    queryFn: () => api.get<RestoreWindowResponse>(`/folders/${id}/restore-point`),
    retry: false,
  })
  const earliest = win.data?.earliest ? Date.parse(win.data.earliest) : null
  const preview = useQuery({
    queryKey: [api.id, "restore-preview", id, at],
    enabled: at !== null,
    queryFn: () => api.post<RestorePreviewResponse>(`/folders/${id}/restore-point/preview`, { at: new Date(at!).toISOString() }),
    retry: false,
    // A preview is a snapshot of now, so it isn't kept.
    gcTime: 0,
  })

  // Android picks the day, then the time.
  const pick = () => {
    const base = new Date(at ?? now - 24 * HOUR)
    DateTimePickerAndroid.open({
      mode: "date",
      value: base,
      maximumDate: new Date(),
      minimumDate: earliest ? new Date(earliest) : undefined,
      onChange: (e, day) => {
        if (e.type !== "set" || !day) return
        DateTimePickerAndroid.open({
          mode: "time",
          value: new Date(new Date(day).setHours(base.getHours(), base.getMinutes(), 0, 0)),
          is24Hour: false,
          onChange: (e2, t) => {
            if (e2.type !== "set" || !t) return
            const ms = new Date(day).setHours(t.getHours(), t.getMinutes(), 0, 0)
            if (ms >= Date.now()) return snack({ text: "Pick a time in the past.", error: true })
            if (earliest && ms < earliest) return snack({ text: `History only goes back to ${when(earliest)}.`, error: true })
            setAt(ms)
          },
        })
      },
    })
  }

  const undo = async (restoreId: string) => {
    try {
      const r = await api.post<RestoreUndoResponse>(`/restore-points/${restoreId}/undo`)
      actions.refresh()
      snack({ text: r.skipped ? `Undid the restore. ${plural(r.skipped, "change")} couldn’t go back.` : "Undid the restore." })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }

  const restore = async () => {
    if (at === null) return
    setBusy(true)
    try {
      const r = await api.post<RestoreApplyResponse>(`/folders/${id}/restore-point/apply`, { at: new Date(at).toISOString() })
      actions.refresh()
      const n = total(r)
      const text = n
        ? `Restored “${name}” to ${when(at)}: ${plural(n, "change")}${r.blocked.length ? `, ${r.blocked.length} couldn’t come back` : ""}.`
        : `Nothing in “${name}” needed restoring.`
      router.back()
      snack({ text, undo: r.id ? () => undo(r.id!) : undefined })
    } catch (e) {
      setBusy(false)
      snack({ text: errorText(e), error: true })
    }
  }

  const data = preview.data
  const count = data ? total(data) : 0
  return (
    <Page title="Restore to a point in time" caption={name}>
      <Section title="Go back to" note="Newer files are kept, and you can undo the restore.">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {PRESETS.map((p) => {
            const back = () => Math.floor((Date.now() - p.ms) / 6e4) * 6e4
            return <Chip key={p.label} label={p.label} disabled={earliest !== null && now - p.ms < earliest} onPress={() => setAt(back())} />
          })}
        </View>
        <Group>
          <Row
            label={at === null ? "Pick a date and time" : when(at)}
            detail={earliest ? `History goes back to ${when(earliest)}` : undefined}
            icon={<CalendarBlank size={22} color={mute} />}
            onPress={pick}
          />
        </Group>
      </Section>

      {at !== null && (
        <Section title="What would change">
          {preview.isPending || preview.isFetching ? (
            <View style={{ height: 96 }}><Spinner /></View>
          ) : preview.error || !data ? (
            <View style={{ gap: 12, alignItems: "flex-start" }}>
              <Text color={c.destructive}>{preview.error ? errorText(preview.error) : "Couldn’t load the preview."}</Text>
              <Button variant="outlined" label="Try again" onPress={() => preview.refetch()} />
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              {!count && !data.blocked.length && <Text color={mute}>Nothing has changed since then, so there’s nothing to restore.</Text>}
              {GROUPS.map(([k, title]) => data[k].length > 0 && <ItemGroup key={k} title={title} items={data[k]} danger={k === "blocked"} />)}
              {data.untracked > 0 && (
                <Text variant="caption" color={mute}>
                  {plural(data.untracked, "item")} {data.untracked === 1 ? "was" : "were"} renamed or moved before Nimbus started keeping track of renames and moves, so {data.untracked === 1 ? "it stays" : "they stay"} as {data.untracked === 1 ? "it is" : "they are"}.
                </Text>
              )}
            </View>
          )}
        </Section>
      )}

      <View style={{ alignSelf: "flex-start" }}>
        <Button label="Restore" busy={busy} disabled={!count || preview.isFetching} onPress={restore} />
      </View>
    </Page>
  )
}

function Chip({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <View style={{ minHeight: 48, justifyContent: "center", opacity: disabled ? 0.45 : 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        android_ripple={{ color: c.ripple }}
        hitSlop={{ top: 6, bottom: 6 }}
        onPress={onPress}
        style={{ height: 36, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: c.input }}
      >
        <Text variant="label">{label}</Text>
      </Pressable>
    </View>
  )
}

function ItemGroup({ title, items, danger }: { title: string; items: RestoreItem[]; danger?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label" color={danger ? c.destructive : mute} accessibilityRole="header">
        {title} · {items.length}
      </Text>
      {items.slice(0, SHOWN).map((i) => (
        <Text key={i.id}>
          {i.name}
          {i.detail ? <Text color={mute}> {i.detail}</Text> : null}
        </Text>
      ))}
      {items.length > SHOWN && <Text color={mute}>and {items.length - SHOWN} more</Text>}
    </View>
  )
}
