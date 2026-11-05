import type { Item, VersionsResponse } from "@nimbus/shared/api"
import { formatBytes } from "@nimbus/shared/file-rules"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowClockwise, ArrowLeft, CheckCircle, Pause, Play, Warning, X } from "phosphor-react-native"
import { router } from "expo-router"
import { FlatList, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { FileIcon } from "@/components/file-icon"
import { useSnack } from "@/components/snackbar"
import { Bar, Button, IconButton, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { c } from "@/lib/theme"
import type { UploadRow } from "@/lib/upload-plan"
import { engine, useUploadRows } from "@/lib/uploads"

export default function Uploads() {
  const inset = useSafeAreaInsets()
  const { id } = useApi()
  const rows = useUploadRows(id)
  const finished = rows.some((r) => r.status === "done" || r.status === "refused")
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Bar>
        <IconButton icon={ArrowLeft} label="Back" onPress={() => router.back()} />
        <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>Uploads</Text>
        {finished && <Button variant="text" label="Clear finished" onPress={() => engine.clear(id, true)} />}
      </Bar>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <UploadItem row={item} />}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: c.border }} />}
        contentContainerStyle={{ paddingBottom: inset.bottom + 24, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
            <Text color={c.mutedForeground} style={{ textAlign: "center" }}>Nothing uploading. Files you upload from New show here.</Text>
          </View>
        }
      />
    </View>
  )
}

function caption(r: UploadRow, version?: number) {
  const of = `${formatBytes(r.sent)} of ${formatBytes(r.size)}`
  switch (r.status) {
    case "queued": return `Queued · ${formatBytes(r.size)}`
    case "waiting": return `Waiting for Wi-Fi · ${formatBytes(r.size)}`
    case "uploading": return of
    case "paused": return `Paused · ${of}`
    case "done": return r.asVersion ? (version ? `v${version} added` : "New version added") : formatBytes(r.size)
    default: return r.error ?? "Couldn't upload this file."
  }
}

function UploadItem({ row: r }: { row: UploadRow }) {
  const api = useApi()
  const client = useQueryClient()
  const snack = useSnack()
  const versions = useQuery({
    queryKey: [api.id, "versions", r.nodeId],
    queryFn: () => api.get<VersionsResponse>(`/items/${r.nodeId}/versions`),
    enabled: r.status === "done" && !!r.asVersion && !!r.nodeId,
  })
  const version = versions.data?.versions.find((v) => v.current)?.number
  const bad = r.status === "failed" || r.status === "refused"
  const pct = r.size ? Math.min(100, Math.round((r.sent / r.size) * 100)) : 0

  // The new copy goes to the trash, with Undo.
  const removeCopy = async () => {
    const refresh = () => client.invalidateQueries({ queryKey: [api.id] })
    try {
      await api.post("/items/trash", { ids: [r.nodeId] })
      engine.drop(r.id)
      refresh()
      snack({
        text: `Moved “${r.name}” to the trash.`,
        undo: async () => {
          await api.post("/items/restore", { ids: [r.nodeId] }).catch(() => {})
          refresh()
        },
      })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }

  return (
    <View style={{ paddingLeft: 16, paddingRight: 4, paddingVertical: 8, minHeight: 64, justifyContent: "center", gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <FileIcon item={{ kind: "file", mime: r.mime, name: r.name } as Pick<Item, "kind" | "mime" | "name">} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1}>{r.name}</Text>
          <Text variant="caption" color={bad ? c.destructive : c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>{caption(r, version)}</Text>
        </View>
        {r.status === "uploading" && <IconButton icon={Pause} label={`Pause ${r.name}`} onPress={() => engine.pause(r.id)} />}
        {r.status === "paused" && <IconButton icon={Play} label={`Resume ${r.name}`} onPress={() => engine.resume(r.id)} />}
        {r.status === "failed" && <IconButton icon={ArrowClockwise} label={`Retry ${r.name}`} onPress={() => engine.retry(r.id)} />}
        {r.status === "done" && !r.duplicateOf && <View accessible accessibilityLabel="Uploaded" style={{ width: 48, alignItems: "center" }}><CheckCircle size={24} color={c.brand} weight="fill" /></View>}
        {r.status === "refused" && <View style={{ width: 48, alignItems: "center" }}><Warning size={24} color={c.destructive} /></View>}
        {r.status !== "done" && <IconButton icon={X} label={`${r.status === "refused" ? "Dismiss" : "Cancel"} ${r.name}`} onPress={() => engine.cancel(r.id)} />}
      </View>
      {(r.status === "uploading" || r.status === "paused") && (
        <View importantForAccessibility="no" style={{ height: 2, marginLeft: 40, marginRight: 12, backgroundColor: c.mutedStrong }}>
          <View style={{ height: 2, width: `${pct}%`, backgroundColor: r.status === "paused" ? c.dim : c.brand }} />
        </View>
      )}
      {r.status === "done" && r.duplicateOf && (
        <View style={{ marginLeft: 40, gap: 4 }}>
          <Text variant="caption" color={c.mutedForeground} numberOfLines={2}>Same as {r.duplicateOf.path}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button variant="text" label="Keep" onPress={() => engine.drop(r.id)} />
            <Button variant="text" label="Remove" onPress={removeCopy} />
          </View>
        </View>
      )}
    </View>
  )
}
