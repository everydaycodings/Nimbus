import type { LinkEvent, LinkEventsResponse } from "@nimbus/shared/api"
import { useQuery } from "@tanstack/react-query"
import { useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { Pressable, View } from "react-native"

import { Group, Loaded, Page } from "@/components/page"
import { Text } from "@/components/ui"
import { useApi } from "@/lib/files"
import { EVENT, describeUa } from "@/lib/share"
import { c, font } from "@/lib/theme"
import { since } from "@/lib/time"

const LIMIT = 500

// "Downloaded · Chrome on Android · 2 hours ago", the address under it, the raw browser text on a tap.
function Event({ e }: { e: LinkEvent }) {
  const [raw, setRaw] = useState(false)
  const what = (EVENT[e.kind] ?? e.kind) + (e.detail ? ` “${e.detail}”` : "")
  const line = [what, describeUa(e.ua), since(e.at)].filter(Boolean).join(" · ")
  const when = new Date(e.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: raw }}
      disabled={!e.ua}
      android_ripple={{ color: c.ripple }}
      onPress={() => setRaw((r) => !r)}
      style={{ minHeight: 56, paddingHorizontal: 16, paddingVertical: 8, gap: 2, justifyContent: "center" }}
    >
      <Text variant="bodySmall">{line}</Text>
      <Text variant="caption" color={c.mutedForeground} style={{ fontVariant: ["tabular-nums"] }}>
        {e.ip ?? "Unknown address"} · {when}
      </Text>
      {raw && (
        <Text selectable variant="caption" color={c.mutedForeground} style={{ fontFamily: font.mono, paddingTop: 4 }}>
          {e.ua}
        </Text>
      )}
    </Pressable>
  )
}

export default function LinkLog() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  const api = useApi()
  const log = useQuery({
    queryKey: [api.id, "link-events", id],
    queryFn: () => api.get<LinkEventsResponse>(`/links/${id}/events?limit=${LIMIT}`),
    select: (d) => d.events,
  })
  return (
    <Page title="Activity" caption={name}>
      <Loaded query={log}>
        {(events) =>
          events.length ? (
            <View style={{ gap: 12 }}>
              <Group>
                {events.map((e, i) => (
                  <Event key={i} e={e} />
                ))}
              </Group>
              <Text variant="caption" color={c.mutedForeground}>Kept for 90 days.</Text>
            </View>
          ) : (
            <Text color={c.mutedForeground}>Nobody has opened this link yet.</Text>
          )
        }
      </Loaded>
    </Page>
  )
}
