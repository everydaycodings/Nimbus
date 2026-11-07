// The Activity section of Details: who changed this file, or what's inside this folder, newest first.
import type { ActivityEvent, ActivityResponse, ActivityType, Item } from "@nimbus/shared/api"
import { useQuery } from "@tanstack/react-query"
import { ActivityIndicator, View } from "react-native"

import { Text } from "@/components/ui"
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
}
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

export function ActivityList({ item }: { item: Item }) {
  const api = useApi()
  const q = useQuery({
    queryKey: [api.id, "activity", item.id, item.updatedAt],
    queryFn: () => api.get<ActivityResponse>(`/files/${item.id}/activity`),
    retry: false,
  })
  // Not theirs to see, or no connection: nothing to show beats an error in Details.
  if (q.isError) return null
  const events = q.data?.events
  const who = (e: ActivityEvent) => (e.actorId === api.account.userId ? "You" : (e.actorName ?? "Someone"))
  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 8, gap: 8 }}>
      <Text variant="caption" color={c.mutedForeground}>
        Activity
      </Text>
      {!events ? (
        <ActivityIndicator size="small" color={c.mutedForeground} accessibilityLabel="Loading" style={{ alignSelf: "flex-start" }} />
      ) : !events.length ? (
        <Text color={c.mutedForeground}>Nothing recorded yet.</Text>
      ) : (
        events.map((e) => (
          <View key={e.id} accessible accessibilityLabel={`${who(e)} ${SAID[e.type]} ${e.name}. ${when(e.at)}`}>
            <Text>
              <Text variant="label">{who(e)}</Text> {SAID[e.type]}
              {item.kind === "folder" && e.nodeId !== item.id ? ` “${e.name}”` : " it"}
            </Text>
            <Text variant="caption" color={c.mutedForeground}>
              {[when(e.at), e.detail].filter(Boolean).join(" · ")}
            </Text>
          </View>
        ))
      )}
    </View>
  )
}
