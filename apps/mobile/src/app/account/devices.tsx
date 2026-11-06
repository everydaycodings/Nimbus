import type { AppPassword, CreateAppPasswordResponse } from "@nimbus/shared/api"
import * as Clipboard from "expo-clipboard"
import { ArrowSquareOut, Check, Copy, Plus } from "phosphor-react-native"
import { useState } from "react"
import { Linking, Pressable, View } from "react-native"

import { Actions, ConfirmDialog, Frame, PromptDialog } from "@/components/dialog"
import { Group, Loaded, Page, Row } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useAccountData, useApi, useFileActions } from "@/lib/files"
import { c, font, radius } from "@/lib/theme"

const SCOPES = [
  { value: "rw", label: "Read & write", hint: "Open, add, change and delete files." },
  { value: "ro", label: "Read only", hint: "Open and download, nothing else." },
] as const

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })

export default function Devices() {
  const api = useApi()
  const account = useAccountData()
  const actions = useFileActions()
  const snack = useSnack()
  const [creating, setCreating] = useState(false)
  const [scope, setScope] = useState<"rw" | "ro">("rw")
  const [shown, setShown] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<AppPassword | null>(null)

  const copy = async (text: string, what: string) => {
    await Clipboard.setStringAsync(text, { android: { isSensitive: what === "password" } })
    snack({ text: `Copied the ${what}.` })
  }

  return (
    <Page title="Connect a device">
      <Text variant="bodySmall" color={c.mutedForeground}>Open your files from a computer&apos;s file manager or an app over WebDAV. Vaults aren&apos;t included.</Text>
      <Loaded query={account}>
        {(a) =>
          !a.appPasswordsEnabled ? (
            <Text color={c.mutedForeground}>WebDAV is turned off for this account.</Text>
          ) : (
            <>
              <View style={{ gap: 8 }}>
                <Text variant="label">Server address</Text>
                <Text selectable style={{ fontFamily: font.mono, fontSize: 13, lineHeight: 20 }}>{a.webdavUrl}</Text>
                <Text variant="bodySmall" color={c.mutedForeground}>
                  Sign in with your email, {a.profile.email}, and an app password. Your account password and two-factor aren&apos;t used here.
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <Button variant="outlined" label="Copy address" icon={<Copy size={18} color={c.foreground} />} onPress={() => copy(a.webdavUrl, "address")} />
                  <Button
                    variant="outlined"
                    label="How to connect"
                    icon={<ArrowSquareOut size={18} color={c.foreground} />}
                    onPress={() => Linking.openURL(`${api.account.server}/account#connect`)}
                  />
                </View>
              </View>

              <Group>
                {a.appPasswords.map((p) => (
                  <Row
                    key={p.id}
                    label={p.name}
                    detail={`${p.scope === "ro" ? "Read only" : "Read & write"} · •••• ${p.lastFour} · Created ${day(p.createdAt)} · ${
                      p.lastUsedAt ? `Last used ${day(p.lastUsedAt)}${p.lastIp ? ` from ${p.lastIp}` : ""}` : "Never used"
                    }`}
                    trailing={<Button variant="outlined" label="Revoke" onPress={() => setRevoking(p)} />}
                  />
                ))}
              </Group>
              <View style={{ alignSelf: "flex-start" }}>
                <Button label="New app password" icon={<Plus size={18} color={c.primaryForeground} />} onPress={() => setCreating(true)} />
              </View>
            </>
          )
        }
      </Loaded>

      {creating && (
        <PromptDialog
          title="New app password"
          label="Device"
          confirm="Create"
          onClose={() => setCreating(false)}
          onSubmit={async (name) => {
            try {
              const r = await api.post<CreateAppPasswordResponse>("/account/app-passwords", { name, scope })
              actions.refresh()
              setShown(r.password)
            } catch (e) {
              return errorText(e)
            }
          }}
        >
          <View style={{ gap: 8 }}>
            {SCOPES.map((s) => {
              const on = scope === s.value
              return (
                <Pressable
                  key={s.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setScope(s.value)}
                  style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.control, borderWidth: 1, borderColor: on ? c.brand : c.input, backgroundColor: on ? c.brandWash : "transparent" }}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="label">{s.label}</Text>
                    <Text variant="caption" color={c.mutedForeground}>{s.hint}</Text>
                  </View>
                  {on && <Check size={20} color={c.brand} />}
                </Pressable>
              )
            })}
          </View>
        </PromptDialog>
      )}
      {shown && (
        <Frame title="Your new app password" onClose={() => setShown(null)}>
          <Text color={c.mutedForeground}>Enter it in the app now. It&apos;s shown only once; if you lose it, revoke it and make another.</Text>
          <Text selectable style={{ fontFamily: font.mono, fontSize: 14, lineHeight: 20, padding: 12, borderRadius: radius.control, borderWidth: 1, borderColor: c.input }}>{shown}</Text>
          <Actions>
            <Button variant="text" label="Copy" onPress={() => copy(shown, "password")} />
            <Button label="Done" onPress={() => setShown(null)} />
          </Actions>
        </Frame>
      )}
      {revoking && (
        <ConfirmDialog
          title={`Revoke “${revoking.name}”?`}
          body="That device stops connecting right away. You can't undo this."
          confirm="Revoke"
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            try {
              await api.del(`/account/app-passwords/${revoking.id}`)
              actions.refresh()
              snack({ text: `Revoked “${revoking.name}”.` })
            } catch (e) {
              snack({ text: errorText(e), error: true })
            }
          }}
        />
      )}
    </Page>
  )
}
