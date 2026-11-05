import type { AccountResponse, NotificationKind, NotificationPref } from "@nimbus/shared/api"
import { useQueryClient } from "@tanstack/react-query"
import { Switch, View } from "react-native"

import { Group, Loaded, Page } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useAccountData, useApi, useInstance } from "@/lib/files"
import { c } from "@/lib/theme"

const KIND_LABEL: Record<NotificationKind, string> = {
  shared: "Something is shared with me",
  access_changed: "My access to something changes",
  access_removed: "Someone removes my access",
  file_drop: "Files arrive through my file-drop links",
  edits: "Editors change things in my shared folders (at most hourly)",
  transfer: "Someone offers me ownership of an item",
  signup_request: "Someone asks to join this Nimbus",
  service_health: "A service goes down or comes back (Admin → Health)",
  backup: "A backup fails, warns, or hasn't run (Admin → Backups)",
  app_password: "A new app password is made for my account",
  storage_low: "My storage is nearly full (90%)",
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
    client.setQueryData<AccountResponse>(key, (a) => a && { ...a, notificationPrefs: a.notificationPrefs.map((x) => (x.kind === p.kind ? next : x)) })
    try {
      await api.put("/account/notification-prefs", { prefs: { [p.kind]: { bell: next.bell, email: next.email } } })
    } catch (e) {
      snack({ text: errorText(e), error: true })
      client.invalidateQueries({ queryKey: key })
    }
  }

  const toggle = (p: NotificationPref, channel: "bell" | "email", name: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Text variant="caption" color={c.mutedForeground}>{name}</Text>
      <Switch
        value={p[channel]}
        onValueChange={(on) => flip(p, channel, on)}
        accessibilityLabel={`${KIND_LABEL[p.kind]}: ${name}`}
        trackColor={{ true: c.brand, false: c.mutedStrong }}
        thumbColor={c.foreground}
      />
    </View>
  )

  return (
    <Page title="Notifications">
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
