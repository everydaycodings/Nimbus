// The Activity section of Details: who changed this file, or what's inside this folder, newest first,
// ten at a time.
import type { ActivityEvent, ActivityResponse, ActivityType, Item } from "@nimbus/shared/api"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { CaretLeft, CaretRight } from "phosphor-react-native"
import { useState } from "react"
import { ActivityIndicator, View } from "react-native"

import { IconButton, Text } from "@/components/ui"
import { useApi } from "@/lib/files"
import { c } from "@/lib/theme"

const SAID: Record<ActivityType, string> = {
  upload: "uploaded",
  version: "saved a new version of",
  rename: "renamed",
  move: "moved",
  share: "changed sharing of",
  trash: "trashed",
  restore: "restored",
  comment: "commented on",
}
const PAGE = 10
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

export function ActivityList({ item }: { item: Item }) {
  const api = useApi()
  const [offset, setOffset] = useState(0)
  const q = useQuery({
    queryKey: [api.id, "activity", item.id, item.updatedAt, offset],
    queryFn: () => api.get<ActivityResponse>(`/files/${item.id}/activity?offset=${offset}&limit=${PAGE}`),
    placeholderData: keepPreviousData,
    retry: false,
  })
  // Not theirs to see, or no connection: nothing to show beats an error in Details.
  if (q.isError) return null
  // Older servers ignore the paging and send everything.
  const events = q.data?.events.slice(0, PAGE)
  const total = q.data?.total ?? events?.length ?? 0
  const who = (e: ActivityEvent) => (e.actorId === api.account.userId ? "You" : (e.actorName ?? "Someone"))
  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 24 }}>
        <Text variant="caption" color={c.mutedForeground} style={{ flex: 1 }}>
          Activity
        </Text>
        {total > PAGE && (
          <View style={{ flexDirection: "row", alignItems: "center", marginVertical: -12 }}>
            <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }} accessibilityLiveRegion="polite">
              {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
            </Text>
            <View style={{ opacity: offset === 0 ? 0.35 : 1 }} pointerEvents={offset === 0 ? "none" : "auto"}>
              <IconButton icon={CaretLeft} label="Newer activity" onPress={() => setOffset((o) => Math.max(0, o - PAGE))} />
            </View>
            <View style={{ opacity: offset + PAGE >= total ? 0.35 : 1 }} pointerEvents={offset + PAGE >= total ? "none" : "auto"}>
              <IconButton icon={CaretRight} label="Older activity" onPress={() => setOffset((o) => o + PAGE)} />
            </View>
          </View>
        )}
      </View>
      {!events ? (
        <ActivityIndicator size="small" color={c.mutedForeground} accessibilityLabel="Loading" style={{ alignSelf: "flex-start" }} />
      ) : !events.length ? (
        <Text color={c.mutedForeground}>Nothing recorded yet.</Text>
      ) : (
        <View style={{ gap: 8, opacity: q.isPlaceholderData ? 0.6 : 1 }}>
          {events.map((e) => (
            <View key={e.id} accessible accessibilityLabel={`${who(e)} ${SAID[e.type] ?? "changed"} ${e.name}. ${when(e.at)}`}>
              <Text>
                <Text variant="label">{who(e)}</Text> {SAID[e.type] ?? "changed"}
                {item.kind === "folder" && e.nodeId !== item.id ? ` “${e.name}”` : " it"}
              </Text>
              <Text variant="caption" color={c.mutedForeground}>
                {[when(e.at), e.detail].filter(Boolean).join(" · ")}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}
