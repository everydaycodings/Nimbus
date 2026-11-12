import type { AccountResponse, NotificationKind, NotificationPref } from "@nimbus/shared/api"
import { useQueryClient } from "@tanstack/react-query"
import { BellRinging, Check, Lightning } from "phosphor-react-native"
import { useCallback, useEffect, useState } from "react"
import { AppState, Linking, Pressable, Switch, View } from "react-native"

import { Group, Loaded, Page, Row, SwitchRow } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, Text } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { errorText } from "@/lib/api"
import { useAccountData, useApi, useInstance } from "@/lib/files"
import { allowNotifications, cardDismissed, dismissCard, liveAvailable, liveOn, notificationsAllowed, pushAvailable, pushRoute, refreshPush, setDistributor, setLive, type PushState } from "@/lib/push"
import { c, radius } from "@/lib/theme"

const KIND_LABEL: Record<NotificationKind, string> = {
  shared: "Something is shared with me",
  access_changed: "My access to something changes",
  access_removed: "Someone removes my access",
  file_drop: "Files arrive through my file-drop links",
  edits: "Editors change things in my shared folders (at most hourly)",
  transfer: "Someone offers me ownership of an item",
  transfer_download: "Someone downloads a transfer I sent (at most hourly)",
  comment: "Comments: a new thread on my file, a reply in my thread, or a mention",
  album: "An album is shared with me, or someone adds photos to one (at most hourly)",
  partner: "Someone invites me to see their photos, or accepts my invite",
  signup_request: "Someone asks to join this Nimbus",
  service_health: "A service goes down or comes back (Admin → Health)",
  backup: "A backup fails, warns, or hasn't run (Admin → Backups)",
  app_password: "A new app password is made for my account",
  storage_low: "My storage is nearly full (90%)",
  phone_backup: "My phone hasn't backed up contacts or calendar for 7 days",
}

const NTFY = "https://f-droid.org/packages/io.heckel.ntfy/"
const NTFY_PLAY = "https://play.google.com/store/apps/details?id=io.heckel.ntfy"

// How notifications reach this phone, and the one-time offer of a push app.
function Delivery() {
  const { accounts } = useAccounts()
  const [state, setState] = useState<PushState>(() => refreshPush())
  const [allowed, setAllowed] = useState(true)
  const [live, setLiveOn] = useState(liveOn)
  const [dismissed, setDismissed] = useState(cardDismissed)
  const look = useCallback(() => {
    setState(refreshPush())
    setLiveOn(liveOn())
    notificationsAllowed().then(setAllowed)
  }, [])
  // Coming back from installing a push app or from system settings.
  useEffect(() => {
    look()
    const sub = AppState.addEventListener("change", (s) => s === "active" && look())
    return () => sub.remove()
  }, [look])

  return (
    <View style={{ gap: 12 }}>
      <Group>
        <Row label="Delivery" detail={pushRoute(state)} icon={<BellRinging size={24} color={c.mutedForeground} />} />
        {liveAvailable && (live || !state.saved) && (
          <SwitchRow
            icon={<Lightning size={24} color={c.mutedForeground} />}
            label={state.saved ? "Use built-in instead of ntfy" : "Instant notifications"}
            detail="Stays connected to your server. Android shows a quiet 'Connected to Nimbus' notification and it uses a little battery."
            value={live}
            onChange={(on) => setLive(on).then(look)}
          />
        )}
        {!allowed && (
          <Row
            label="Notifications are off for Nimbus"
            detail="Allow them to see alerts outside the app."
            trailing={<Button variant="outlined" label="Allow" onPress={() => allowNotifications().then(setAllowed)} />}
          />
        )}
      </Group>
      {state.distributors.length > 1 && (
        <Group>
          {state.distributors.map((d) => (
            <Row
              key={d.id}
              label={d.name}
              detail={state.saved?.id === d.id ? "Delivering your notifications" : "Use this instead"}
              trailing={state.saved?.id === d.id ? <Check size={20} color={c.brand} /> : undefined}
              onPress={() => setDistributor(d.id, accounts).then(look)}
            />
          ))}
        </Group>
      )}
      {pushAvailable && !live && !state.saved && !state.distributors.length && !dismissed && (
        <View style={{ padding: 16, gap: 12, backgroundColor: c.brandWash, borderWidth: 1, borderColor: c.border, borderRadius: radius.card }}>
          <Text variant="titleSmall">Get instant notifications</Text>
          <Text variant="bodySmall" color={c.mutedForeground}>
            {liveAvailable ? "Turn on Instant notifications above, or install ntfy. " : ""}Without either, Nimbus checks every 15 minutes. ntfy is a free app that delivers them at once; it only learns that something happened, never what.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Button label="F-Droid" onPress={() => Linking.openURL(NTFY)} />
            <Button variant="outlined" label="Google Play" onPress={() => Linking.openURL(NTFY_PLAY)} />
            <Button
              variant="text"
              label="Not now"
              onPress={() => {
                dismissCard()
                setDismissed(true)
              }}
            />
          </View>
        </View>
      )}
    </View>
  )
}

export default function NotificationPrefs() {
  const api = useApi()
  const account = useAccountData()
  const instance = useInstance()
  const client = useQueryClient()
  const snack = useSnack()
  const key = [api.id, "account"]

  // Saved as you flip it, and answers at once; a refused change snaps back.
  const flip = async (p: NotificationPref, channel: "bell" | "email", on: boolean) => {
    const next = { ...p, [channel]: on }
    if (on && channel === "bell") allowNotifications()
    client.setQueryData<AccountResponse>(key, (a) => a && { ...a, notificationPrefs: a.notificationPrefs.map((x) => (x.kind === p.kind ? next : x)) })
    try {
      await api.put("/account/notification-prefs", { prefs: { [p.kind]: { bell: next.bell, email: next.email } } })
    } catch (e) {
      snack({ text: errorText(e), error: true })
      client.invalidateQueries({ queryKey: key })
    }
  }

  // The whole "Bell [switch]" pair is one 48dp target; the bare Switch alone was 27dp tall.
  const toggle = (p: NotificationPref, channel: "bell" | "email", name: string) => (
    <Pressable
      onPress={() => flip(p, channel, !p[channel])}
      accessibilityRole="switch"
      accessibilityLabel={`${KIND_LABEL[p.kind]}: ${name}`}
      accessibilityState={{ checked: p[channel] }}
      style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 48 }}
    >
      <Text variant="caption" color={c.mutedForeground}>{name}</Text>
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <Switch value={p[channel]} trackColor={{ true: c.brand, false: c.mutedStrong }} thumbColor={c.foreground} />
      </View>
    </Pressable>
  )

  return (
    <Page title="Notifications">
      <Delivery />
      <Text variant="bodySmall" color={c.mutedForeground}>
        {instance.data && !instance.data.email
          ? "Choose where each kind reaches you. This Nimbus can't send email yet, so email choices apply once an admin sets it up."
          : "Choose where each kind reaches you: under the bell, by email, or both."}
      </Text>
      <Loaded query={account}>
        {(a) => (
          <Group>
            {a.notificationPrefs.map((p) => (
              <View key={p.kind} style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 4 }}>
                <Text>{KIND_LABEL[p.kind]}</Text>
                <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 16 }}>
                  {toggle(p, "bell", "Bell")}
                  {toggle(p, "email", "Email")}
                </View>
              </View>
            ))}
          </Group>
        )}
      </Loaded>
    </Page>
  )
}
