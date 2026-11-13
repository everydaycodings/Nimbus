import { router } from "expo-router"
import { Bell, CheckCircle, DeviceMobile, Fingerprint, Key, LockKey, PencilSimple, Password, ShieldCheck, UserFocus, UsersThree } from "phosphor-react-native"
import { useState } from "react"
import { Pressable, View } from "react-native"

import { Avatar, serverName } from "@/components/avatar"
import { FaceGroupingRow } from "@/components/people-ui"
import { Caret, Group, Loaded, Page, Row } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useAccountData, useApi, useInstance } from "@/lib/files"
import { c } from "@/lib/theme"

const PROVIDERS: Record<string, string> = { credential: "Password", google: "Google", github: "GitHub" }

export default function Account() {
  const api = useApi()
  const account = useAccountData()
  const instance = useInstance()
  const snack = useSnack()
  const [sending, setSending] = useState(false)
  const icon = (I: typeof Key) => <I size={24} color={c.mutedForeground} />
  const providerName = (id: string) => PROVIDERS[id] ?? instance.data?.providers.oidc?.name ?? id

  const resend = async () => {
    setSending(true)
    try {
      await api.post("/account/resend-verification")
      snack({ text: "Sent. Check your email." })
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
    setSending(false)
  }

  return (
    <Page title="Account">
      <Loaded query={account}>
        {(a) => (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change avatar"
                onPress={() => router.push("/account/avatar")}
                style={{ width: 72, height: 72 }}
              >
                <Avatar account={api.account} name={a.profile.name} image={a.profile.image} size={72} />
                <View style={{ position: "absolute", right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: c.muted, borderWidth: 2, borderColor: c.background }}>
                  <PencilSimple size={14} color={c.foreground} />
                </View>
              </Pressable>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="titleSmall" numberOfLines={1}>{a.profile.name}</Text>
                <View
                  accessible
                  accessibilityLabel={`${a.profile.email}${a.profile.emailVerified ? ", verified" : ", not verified"}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <Text variant="bodySmall" color={c.mutedForeground} numberOfLines={1} style={{ flexShrink: 1 }}>{a.profile.email}</Text>
                  {a.profile.emailVerified && <CheckCircle size={16} weight="fill" color={c.brand} />}
                </View>
                <Text variant="bodySmall" color={c.mutedForeground} numberOfLines={1}>{serverName(api.account.server)}</Text>
                {api.account.server.startsWith("http://") && <Text variant="caption" color={c.warning}>Not encrypted</Text>}
              </View>
            </View>

            {!a.profile.emailVerified && instance.data?.email && (
              <View style={{ gap: 12, alignItems: "flex-start" }}>
                <Text variant="bodySmall" color={c.mutedForeground}>
                  Your email isn&apos;t verified. Confirm it so you can later sign in with Google or GitHub using the same address.
                </Text>
                <Button variant="outlined" label="Send the email again" busy={sending} onPress={resend} />
              </View>
            )}

            <Group>
              <Row
                label="Sign-in methods"
                detail={a.linkedProviders.map(providerName).join(", ")}
                icon={icon(Key)}
                trailing={<Caret />}
                onPress={() => router.push("/account/methods")}
              />
              <Row
                label="Password"
                detail={a.hasPassword ? "Changing it signs you out everywhere else" : "Not set"}
                icon={icon(Password)}
                trailing={<Caret />}
                onPress={() => router.push("/account/password")}
              />
              <Row
                label="Passkeys"
                detail={a.passkeys.available ? (a.passkeys.items.length ? `${a.passkeys.items.length} added` : "Sign in with your fingerprint or screen lock") : a.passkeys.reason}
                icon={icon(Fingerprint)}
                trailing={a.passkeys.available ? <Caret /> : undefined}
                onPress={a.passkeys.available ? () => router.push("/account/passkeys") : undefined}
              />
              <Row
                label="Two-factor authentication"
                detail={a.twoFactor ? "On" : "Off"}
                icon={icon(ShieldCheck)}
                trailing={<Caret />}
                onPress={() => router.push("/account/two-factor")}
              />
            </Group>
            <Group>
              <Row label="Notifications" detail="What reaches you, and where" icon={icon(Bell)} trailing={<Caret />} onPress={() => router.push("/account/notifications")} />
              {a.appPasswordsEnabled && (
                <Row
                  label="Connect a device"
                  detail={a.appPasswords.length ? `${a.appPasswords.length} app password${a.appPasswords.length === 1 ? "" : "s"}` : "Open your files from a computer or another app"}
                  icon={icon(DeviceMobile)}
                  trailing={<Caret />}
                  onPress={() => router.push("/account/devices")}
                />
              )}
              <Row label="Partner sharing" detail="Share your photos with one person" icon={icon(UsersThree)} trailing={<Caret />} onPress={() => router.push("/account/partner")} />
              <FaceGroupingRow icon={icon(UserFocus)} />
              <Row label="Vault lock" detail={`After ${a.vaultLockMinutes} minutes idle`} icon={icon(LockKey)} trailing={<Caret />} onPress={() => router.push("/account/vault-lock")} />
            </Group>
          </>
        )}
      </Loaded>
    </Page>
  )
}
