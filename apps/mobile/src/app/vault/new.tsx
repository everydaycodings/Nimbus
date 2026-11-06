import { useQueryClient } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { router, useFocusEffect } from "expo-router"
import { Check, Copy, ShareNetwork, ShieldCheck } from "phosphor-react-native"
import { useCallback, useState } from "react"
import { BackHandler, Share, View } from "react-native"

import { Page } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, ErrorText, Field, Text } from "@/components/ui"
import { Secure, useVaultLock } from "@/components/vault-lock"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { c, radius } from "@/lib/theme"
import { vaultNative } from "@/lib/vault"

const MIN = 12

type Made = { id: string; name: string; code: string }

export default function NewVault() {
  const api = useApi()
  const snack = useSnack()
  const client = useQueryClient()
  const { markOpen } = useVaultLock()
  const [understood, setUnderstood] = useState(false)
  const [name, setName] = useState("")
  const [pass, setPass] = useState("")
  const [again, setAgain] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<Made | null>(null)

  // The code is shown once, so Back can't be allowed to lose it.
  useFocusEffect(
    useCallback(() => {
      if (!made) return
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        snack({ text: "Save your recovery code first." })
        return true
      })
      return () => sub.remove()
    }, [made, snack])
  )

  if (!vaultNative) return <Page title="New vault"><Text color={c.mutedForeground}>Vaults need the installed Nimbus app.</Text></Page>
  const vn = vaultNative

  const short = pass.length < MIN
  const ok = name.trim().length > 0 && !short && pass === again
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const k = JSON.parse(await vn.vaultCreate(pass)) as { handle: string; salt: string; kdf: { t: number; m: number }; wrapped: string; recoveryWrapped: string; recoveryCode: string }
      const { id } = await api.post<{ id: string }>("/vaults", { name: name.trim(), salt: k.salt, wrapped: k.wrapped, recoveryWrapped: k.recoveryWrapped, kdf: k.kdf })
      vn.vaultAdopt(k.handle, api.id, id)
      markOpen(id)
      client.invalidateQueries({ queryKey: [api.id, "vaults"] })
      setMade({ id, name: name.trim(), code: k.recoveryCode })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (made)
    return (
      <Page title="Recovery code" onBack={null}>
        <Secure />
        <Text>This code opens “{made.name}” if you forget your passphrase. It is shown once. Write it down or save it somewhere safe, away from this phone.</Text>
        <View style={{ padding: 16, borderRadius: radius.card, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
          <Text selectable accessibilityLabel={`Recovery code, ${made.code.split("").join(" ")}`} style={{ fontFamily: "GeistMono_400Regular", fontSize: 18, lineHeight: 28, letterSpacing: 1 }}>{made.code}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button variant="outlined" label="Copy" icon={<Copy size={18} color={c.foreground} />} onPress={async () => { await Clipboard.setStringAsync(made.code, { android: { isSensitive: true } }); snack({ text: "Copied the recovery code." }) }} />
          </View>
          <View style={{ flex: 1 }}>
            <Button variant="outlined" label="Share" icon={<ShareNetwork size={18} color={c.foreground} />} onPress={() => Share.share({ message: made.code }).catch(() => {})} />
          </View>
        </View>
        <Button label="I've saved it" icon={<Check size={18} color={c.primaryForeground} />} onPress={() => router.replace({ pathname: "/vault/[id]", params: { id: made.id, name: made.name } })} />
      </Page>
    )

  if (!understood)
    return (
      <Page title="New vault">
        <View style={{ gap: 12 }}>
          <ShieldCheck size={32} color={c.brand} />
          <Text variant="titleSmall">Only you can open a vault</Text>
          <Text color={c.mutedForeground}>Files and names are encrypted on your phone with a passphrase only you know. Nimbus, and anyone running this server, can't read them.</Text>
          <Text color={c.mutedForeground}>If you forget the passphrase, the recovery code is the only way back in. Lose both and the vault's contents are gone for good.</Text>
        </View>
        <Button label="I understand" onPress={() => setUnderstood(true)} />
      </Page>
    )

  return (
    <Page title="New vault">
      <Field label="Name" value={name} onChangeText={setName} autoFocus returnKeyType="next" maxLength={80} />
      <Field label="Passphrase" secret value={pass} onChangeText={setPass} autoCapitalize="none" autoCorrect={false} returnKeyType="next" hint={short ? `At least ${MIN} characters (${pass.length} so far). A few words strung together works well.` : "Long enough."} />
      <Field
        label="Repeat passphrase"
        secret
        value={again}
        onChangeText={setAgain}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        error={again && pass !== again ? "The passphrases don't match." : null}
        onSubmitEditing={() => ok && create()}
      />
      {error && <ErrorText>{error}</ErrorText>}
      <Button label="Create vault" busy={busy} disabled={!ok} onPress={create} />
    </Page>
  )
}
