import type { Item } from "@nimbus/shared/api"
import { formatBytes } from "@nimbus/shared/file-rules"
import { router, useFocusEffect } from "expo-router"
import { ArrowLeft, Pause, Play, X } from "phosphor-react-native"
import { useCallback, useState } from "react"
import { FlatList, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ConfirmDialog } from "@/components/dialog"
import { FileIcon } from "@/components/file-icon"
import { Bar, Button, IconButton, Text } from "@/components/ui"
import { useBackup } from "@/lib/backup"
import { describe, type QueueRow } from "@/lib/backup-rules"
import { native } from "@/lib/native"
import { c, radius } from "@/lib/theme"

type Line = { kind: "row"; row: QueueRow } | { kind: "skipped"; mediaId: string; name: string } | { kind: "heading"; text: string; all?: () => void }

// Camera backup's queue: what's sending and what's next, with pause and skip for the lot or one file.
export default function BackupQueue() {
  const inset = useSafeAreaInsets()
  const { settings, status, change, refresh } = useBackup()
  const [rows, setRows] = useState<QueueRow[]>([])
  const [confirm, setConfirm] = useState(false)
  const load = useCallback(() => setRows(JSON.parse(native?.backupQueue?.() || "[]")), [])
  // Sent bytes change without an event, so the screen looks again every second while it's up.
  useFocusEffect(
    useCallback(() => {
      load()
      const t = setInterval(load, 1000)
      return () => clearInterval(t)
    }, [load])
  )
  const act = (f: () => void) => {
    f()
    load()
    setTimeout(refresh, 300)
  }
  const line = describe(status)
  const skipped = status.skipped ?? []
  const lines: Line[] = [
    ...rows.map((row) => ({ kind: "row" as const, row })),
    ...(skipped.length
      ? [
          { kind: "heading" as const, text: `Skipped (${skipped.length})`, all: () => act(() => native?.backupUnskip?.(null)) },
          ...skipped.map((s) => ({ kind: "skipped" as const, ...s })),
        ]
      : []),
  ]

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
        <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>Backup queue</Text>
        {rows.length > 0 && <Button variant="text" danger label="Skip all" onPress={() => setConfirm(true)} />}
      </Bar>
      <FlatList
        data={lines}
        keyExtractor={(l) => (l.kind === "row" ? l.row.id : l.kind === "skipped" ? `s-${l.mediaId}` : "heading")}
        contentContainerStyle={{ paddingBottom: inset.bottom + 24, flexGrow: 1 }}
        ListHeaderComponent={
          <View accessibilityLiveRegion="polite" style={{ margin: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: c.border, borderRadius: radius.card, backgroundColor: c.card }}>
            <View style={{ gap: 2 }}>
              <Text variant="titleSmall">{line.title}</Text>
              <Text variant="bodySmall" color={c.mutedForeground}>{line.detail}</Text>
            </View>
            <View style={{ alignItems: "flex-start" }}>
              {settings.paused ? (
                <Button label="Resume backup" onPress={() => act(() => change({ paused: false }))} />
              ) : (
                <Button variant="outlined" label="Pause backup" onPress={() => act(() => change({ paused: true }))} />
              )}
            </View>
          </View>
        }
        renderItem={({ item: l }) =>
          l.kind === "row" ? (
            <QueueItem row={l.row} backupPaused={settings.paused} act={act} />
          ) : l.kind === "heading" ? (
            <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 8, paddingTop: 16, minHeight: 48 }}>
              <Text variant="titleSmall" accessibilityRole="header" style={{ flex: 1 }}>{l.text}</Text>
              <Button variant="text" label="Back up all" onPress={l.all!} />
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingLeft: 16, paddingRight: 8, minHeight: 56 }}>
              <FileIcon item={{ kind: "file", mime: null, name: l.name } as Pick<Item, "kind" | "mime" | "name">} />
              <Text numberOfLines={1} style={{ flex: 1 }}>{l.name}</Text>
              <Button variant="text" label="Back up" onPress={() => act(() => native?.backupUnskip?.(l.mediaId))} />
            </View>
          )
        }
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
            <Text color={c.mutedForeground} style={{ textAlign: "center" }}>Nothing waiting to back up.</Text>
          </View>
        }
      />
      {confirm && (
        <ConfirmDialog
          title="Skip everything waiting?"
          body="These photos and videos won't be backed up. You can back them up later from Skipped."
          confirm="Skip all"
          onClose={() => setConfirm(false)}
          onConfirm={() => act(() => native?.backupSkip?.(null))}
        />
      )}
    </View>
  )
}

function caption(r: QueueRow, backupPaused: boolean) {
  const of = `${formatBytes(r.sent)} of ${formatBytes(r.size)}`
  if (r.status === "paused") return `Paused · ${of}`
  if (r.status === "uploading") return of
  if (r.status === "waiting") return `Waiting for Wi-Fi · ${formatBytes(r.size)}`
  return `${backupPaused ? "Paused with backup" : "Queued"} · ${r.sent ? of : formatBytes(r.size)}`
}

function QueueItem({ row: r, backupPaused, act }: { row: QueueRow; backupPaused: boolean; act: (f: () => void) => void }) {
  const pct = r.size ? Math.min(100, Math.round((r.sent / r.size) * 100)) : 0
  const paused = r.status === "paused"
  return (
    <View style={{ paddingLeft: 16, paddingRight: 4, paddingVertical: 8, minHeight: 64, justifyContent: "center", gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <FileIcon item={{ kind: "file", mime: r.mime, name: r.name } as Pick<Item, "kind" | "mime" | "name">} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1}>{r.name}</Text>
          <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{caption(r, backupPaused)}</Text>
        </View>
        {paused ? (
          <IconButton icon={Play} label={`Resume ${r.name}`} onPress={() => act(() => native?.resumeUpload(r.id))} />
        ) : (
          <IconButton icon={Pause} label={`Pause ${r.name}`} onPress={() => act(() => native?.pauseUpload(r.id))} />
        )}
        <IconButton icon={X} label={`Skip ${r.name}`} onPress={() => act(() => native?.backupSkip?.(r.id))} />
      </View>
      {(r.status === "uploading" || (paused && r.sent > 0)) && (
        <View importantForAccessibility="no" style={{ height: 2, marginLeft: 40, marginRight: 12, backgroundColor: c.mutedStrong }}>
          <View style={{ height: 2, width: `${pct}%`, backgroundColor: paused ? c.dim : c.brand }} />
        </View>
      )}
    </View>
  )
}
