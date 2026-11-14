import type { Notification, NotificationsResponse } from "@nimbus/shared/api"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { router, type Href } from "expo-router"
import { useEffect, useRef, useState } from "react"
import { Linking, Pressable, View } from "react-native"

import { Group, Loaded, Page } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi, useFileActions } from "@/lib/files"
import { notificationTarget } from "@/lib/notifications"
import { openPreview } from "@/lib/preview-session"
import { folderHref } from "@/lib/tab"
import { c } from "@/lib/theme"
import { since } from "@/lib/time"
import type { Item } from "@nimbus/shared/api"

const GONE = "This is gone, or you can't see it any more."

export default function Notifications() {
  const api = useApi()
  const client = useQueryClient()
  const actions = useFileActions()
  const snack = useSnack()
  const [answering, setAnswering] = useState<string | null>(null)
  // gcTime 0: every visit starts from what's true now, not the last visit's copy.
  const list = useQuery({
    queryKey: [api.id, "notifications"],
    gcTime: 0,
    queryFn: () => api.get<NotificationsResponse>("/notifications"),
  })

  // Opening counts as seeing them. What was new stays marked for this visit.
  const fresh = useRef<Set<string> | null>(null)
  if (list.data && !fresh.current) fresh.current = new Set(list.data.items.filter((n) => !n.read).map((n) => n.id))
  const loaded = !!list.data
  useEffect(() => {
    if (!loaded || !fresh.current?.size) return
    api.post("/notifications/read", {}).then(
      () => client.invalidateQueries({ queryKey: [api.id, "counts"] }),
      () => {}
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit
  }, [loaded])

  const open = async (n: Notification) => {
    const target = notificationTarget(n)
    if (target.to === "browser") return Linking.openURL(api.account.server + target.path)
    if (target.to === "album") return router.push({ pathname: "/albums/[id]", params: { id: target.id } })
    if (target.to === "document") return router.push({ pathname: "/documents/[id]", params: { id: target.id } })
    if (target.to === "route") return router.push(target.path as Href)
    try {
      const { item } = await api.get<{ item: Item | null }>(`/items/${target.id}`)
      if (!item || item.trashedAt) return snack({ text: GONE })
      if (item.kind === "folder") router.push({ pathname: folderHref(item.role ? "(shared)" : "(files)", item.id), params: { name: item.name } })
      else {
          openPreview({ items: [item], index: 0, role: item.role ?? "owner" })
          if (target.comments) router.push({ pathname: "/comments/[id]", params: { id: item.id, name: item.name } })
        }
    } catch {
      snack({ text: GONE })
    }
  }

  const answer = async (n: Notification, accept: boolean) => {
    setAnswering(n.id)
    try {
      await api.post(`/items/${n.nodeId}/ownership/answer`, { accept })
      actions.refresh()
      snack({ text: accept ? "It's yours now." : "Declined. Nothing changed." })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
    setAnswering(null)
  }

  return (
    <Page title="Notifications">
      <Loaded query={list}>
        {(d) =>
          d.items.length === 0 ? (
            <Text color={c.mutedForeground}>Nothing new. Shares, file drops and edits in your shared folders show up here.</Text>
          ) : (
            <Group>
              {d.items.map((n) => {
                const isNew = !!fresh.current?.has(n.id)
                return (
                  <View key={n.id} style={{ backgroundColor: isNew ? c.brandWash : undefined }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${n.text}${isNew ? ", new" : ""}, ${since(n.createdAt)}`}
                      android_ripple={{ color: c.ripple }}
                      onPress={() => open(n)}
                      style={{ minHeight: 64, flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
                    >
                      <View style={{ width: 8, height: 8, marginTop: 7, borderRadius: 4, backgroundColor: isNew ? c.brand : "transparent" }} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text color={isNew ? c.foreground : c.mutedForeground}>{n.text}</Text>
                        <Text variant="caption" color={c.mutedForeground}>{since(n.createdAt)}</Text>
                      </View>
                    </Pressable>
                    {n.pending && (
                      <View style={{ flexDirection: "row", gap: 8, paddingLeft: 36, paddingRight: 16, paddingBottom: 12 }}>
                        <Button label="Accept" busy={answering === n.id} onPress={() => answer(n, true)} />
                        <Button variant="outlined" label="Decline" disabled={answering === n.id} onPress={() => answer(n, false)} />
                      </View>
                    )}
                  </View>
                )
              })}
            </Group>
          )
        }
      </Loaded>
    </Page>
  )
}
