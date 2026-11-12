import { useQueryClient } from "@tanstack/react-query"
import * as Network from "expo-network"
import { router } from "expo-router"
import { ArrowsClockwise, CaretRight, CloudSlash, Warning } from "phosphor-react-native"
import { useCallback, useEffect, useRef } from "react"
import { AppState, Pressable, View } from "react-native"

import { useSnack } from "@/components/snackbar"
import { Text } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { json } from "@/lib/api"
import { setUnreachable, useOnline } from "@/lib/connectivity"
import { refreshAll, takeNotices } from "@/lib/offline"
import { replay, useQueue } from "@/lib/offline-queue"
import { runDue } from "@/lib/phone-backup"
import { scheduleBackgroundRefresh } from "@/lib/offline-task"
import { c, radius } from "@/lib/theme"

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`

// One slim line above the tabs: no connection (and what's waiting), changes on their way, or changes that
// couldn't sync. It takes no space when everything's fine, and shares the slot with the upload strip.
export function OfflineBar({ floating }: { floating?: boolean }) {
  const { active } = useAccounts()
  const online = useOnline()
  const q = useQueue(active?.id ?? "")
  if (!active || (online && !q.waiting && !q.failed.length)) return null
  const failedOnly = online && !q.waiting
  const Icon = failedOnly ? Warning : online ? ArrowsClockwise : CloudSlash
  const tint = failedOnly ? c.destructive : online ? c.brand : c.warning
  const text = failedOnly
    ? `${plural(q.failed.length, "change")} couldn't sync`
    : online
      ? `Syncing ${plural(q.waiting, "change")}`
      : q.waiting
        ? `Offline · ${plural(q.waiting, "change")} waiting`
        : "Offline"
  return (
    <View style={[{ backgroundColor: c.card }, floating ? { borderRadius: radius.card, borderWidth: 1, borderColor: c.border, overflow: "hidden" } : { borderTopWidth: 1, borderTopColor: c.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text}
        accessibilityHint="Opens Offline"
        android_ripple={{ color: c.ripple }}
        onPress={() => router.push("/offline")}
        style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16 }}
      >
        <Icon size={20} color={tint} />
        <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>{text}</Text>
        <CaretRight size={16} color={c.mutedForeground} />
      </Pressable>
    </View>
  )
}

// Keeps connectivity honest and does the catching up: replays the queue when the server is back and
// refreshes offline files when the app opens. Draws nothing.
export function OfflineWatcher() {
  const online = useOnline()
  const { active, ready } = useAccounts()
  const client = useQueryClient()
  const snack = useSnack()
  const lastRefresh = useRef(0)

  useEffect(() => {
    const sub = Network.addNetworkStateListener((s) => setUnreachable(s.isConnected === false || s.isInternetReachable === false))
    scheduleBackgroundRefresh()
    return () => sub.remove()
  }, [])

  // Offline, ask the server now and then: the first answer flips the app back online.
  useEffect(() => {
    if (online || !active) return
    const timer = setInterval(() => json(active.server, "/api/v1/instance").catch(() => {}), 15_000)
    return () => clearInterval(timer)
  }, [online, active])

  const catchUp = useCallback(async () => {
    const r = await replay().catch(() => ({ done: 0, failed: 0 }))
    if (r.done || r.failed) client.invalidateQueries()
    if (Date.now() - lastRefresh.current > 10 * 60_000) {
      lastRefresh.current = Date.now()
      await refreshAll().catch(() => {})
      runDue().catch(() => {})
    }
    const told = takeNotices()
    if (told.length) snack({ text: told.length > 1 ? `${told[0]} And ${told.length - 1} more.` : told[0] })
    else if (r.failed) snack({ text: `${plural(r.failed, "change")} couldn't sync. Open Offline to retry or discard.`, error: true })
    else if (r.done) snack({ text: `Synced ${plural(r.done, "change")}.` })
  }, [client, snack])

  useEffect(() => {
    if (!ready || !online || !active) return
    catchUp()
    const sub = AppState.addEventListener("change", (s) => s === "active" && catchUp())
    return () => sub.remove()
  }, [ready, online, active, catchUp])
  return null
}
