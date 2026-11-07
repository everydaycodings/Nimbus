// "Share link" for vault files and folders. The link opens in a browser, which decrypts the files itself.
import * as Clipboard from "expo-clipboard"
import { Check, Copy, ShareNetwork, Warning } from "phosphor-react-native"
import { useState } from "react"
import { Pressable, Share, View } from "react-native"

import { Actions, Frame } from "@/components/dialog"
import { useSnack } from "@/components/snackbar"
import { Button, Field, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { c, radius } from "@/lib/theme"
import type { VaultNative } from "@/lib/vault"
import { createVaultLink } from "@/lib/vault-links"
import type { VaultEntry } from "@/lib/vault-rules"

const MIN = 12
const EXPIRY = [
  { label: "1 day", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "Never", days: null },
] as const

// One of a few choices, as chips.
function Choice<T extends string | number | null>({ label, value, options, onChange }: { label: string; value: T; options: readonly { label: string; value: T }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => {
          const on = o.value === value
          return (
            <Pressable
              key={o.label}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              android_ripple={{ color: c.ripple }}
              onPress={() => onChange(o.value)}
              style={{ minHeight: 48, paddingHorizontal: 16, justifyContent: "center", borderRadius: radius.control, borderWidth: 1, borderColor: on ? c.brand : c.input, backgroundColor: on ? "rgba(255,255,255,0.06)" : "transparent" }}
            >
              <Text variant="label" color={on ? c.foreground : c.mutedForeground}>{o.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export function VaultLinkDialog({ vaultId, vn, all, targets, onClose }: { vaultId: string; vn: VaultNative; all: VaultEntry[]; targets: VaultEntry[]; onClose: () => void }) {
  const api = useApi()
  const snack = useSnack()
  const [mode, setMode] = useState<"key" | "pass">("key")
  const pass = mode === "pass"
  const [days, setDays] = useState<1 | 7 | 30 | null>(7)
  const [phrase, setPhrase] = useState("")
  const [again, setAgain] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const ok = !pass || (phrase.length >= MIN && phrase === again)
  const title = targets.length === 1 ? targets[0].name : `${targets.length} items`

  const make = async () => {
    if (!ok || busy) return
    setBusy(true)
    setError(null)
    try {
      setUrl(await createVaultLink(api, vn, vaultId, all, targets, { passphrase: pass ? phrase : null, expiresInDays: days }))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (url)
    return (
      <Frame title="Link ready" onClose={onClose}>
        <Text variant="bodySmall" selectable style={{ padding: 12, borderRadius: radius.control, borderWidth: 1, borderColor: c.input }}>{url}</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            variant="outlined"
            label={copied ? "Copied" : "Copy"}
            icon={copied ? <Check size={20} color={c.foreground} /> : <Copy size={20} color={c.foreground} />}
            onPress={async () => {
              await Clipboard.setStringAsync(url)
              setCopied(true)
              snack({ text: "Link copied." })
            }}
          />
          <Button variant="outlined" label="Send" icon={<ShareNetwork size={20} color={c.foreground} />} onPress={() => Share.share({ message: url })} />
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Warning size={20} color={c.mutedForeground} />
          <Text variant="caption" color={c.mutedForeground} style={{ flex: 1 }}>
            Anyone with this link can open these files. Revoke it to stop that.
            {pass ? " They also need the passphrase, so send it another way." : " This link can't be shown again, so copy it now."}
          </Text>
        </View>
        <Actions>
          <Button label="Done" onPress={onClose} />
        </Actions>
      </Frame>
    )

  return (
    <Frame title={`Share link for “${title}”`} onClose={onClose}>
      <Text color={c.mutedForeground}>The files stay encrypted on the server. The link carries the key for just these files, not your vault.</Text>
      <Choice
        label="Opens with"
        value={mode}
        options={[{ label: "The link alone", value: "key" }, { label: "A passphrase too", value: "pass" }] as const}
        onChange={setMode}
      />
      {pass && (
        <>
          <Field label="Link passphrase" secret value={phrase} autoCapitalize="none" autoCorrect={false} onChangeText={setPhrase} returnKeyType="next" hint={phrase.length < MIN ? `At least ${MIN} characters (${phrase.length} so far).` : "Long enough."} />
          <Field label="Repeat it" secret value={again} autoCapitalize="none" autoCorrect={false} onChangeText={setAgain} returnKeyType="done" onSubmitEditing={make} error={again && phrase !== again ? "The passphrases don't match." : null} />
        </>
      )}
      <Choice label="Expires" value={days} options={EXPIRY.map((e) => ({ label: e.label, value: e.days }))} onChange={setDays} />
      {error && <Text color={c.destructive}>{error}</Text>}
      <Actions>
        <Button variant="text" label="Cancel" onPress={onClose} />
        <Button label="Create link" busy={busy} disabled={!ok} onPress={make} />
      </Actions>
    </Frame>
  )
}
