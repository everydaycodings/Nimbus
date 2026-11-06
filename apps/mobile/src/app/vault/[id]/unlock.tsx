import type { VaultResponse } from "@nimbus/shared/api"
import { router, useLocalSearchParams } from "expo-router"
import { Fingerprint, Lock } from "phosphor-react-native"
import { useEffect, useRef, useState } from "react"
import { View } from "react-native"

import { Page } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, Field, Text } from "@/components/ui"
import { useVaultLock, VaultShell } from "@/components/vault-lock"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { c } from "@/lib/theme"
import { vaultNative } from "@/lib/vault"

export default function Unlock() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>()
  if (!vaultNative) return <Page title="Vault"><Text color={c.mutedForeground}>Vaults need the installed Nimbus app.</Text></Page>
  return <Form id={id} name={name ?? "Vault"} vn={vaultNative} />
}

function Form({ id, name, vn }: { id: string; name: string; vn: NonNullable<typeof vaultNative> }) {
  const api = useApi()
  const snack = useSnack()
  const { isOpen, markOpen } = useVaultLock()
  const [recovery, setRecovery] = useState(false)
  const [secret, setSecret] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bio, setBio] = useState(() => vn.vaultBioEnabled(api.id, id))

  const enter = (changePassphrase: boolean) => {
    markOpen(id)
    // Replaces this screen, so Back from the vault doesn't return to the passphrase.
    router.replace(changePassphrase ? { pathname: "/vault/[id]/settings", params: { id, name, change: "1" } } : { pathname: "/vault/[id]", params: { id, name } })
  }

  const fingerprint = async () => {
    try {
      const r = await vn.vaultBioUnlock(api.id, id)
      if (r === "ok") enter(false)
      else if (r === "invalidated" || r === "none") {
        setBio(false)
        if (r === "invalidated") snack({ text: "Fingerprints changed, use your passphrase.", error: true })
      }
    } catch (e) {
      setError(errorText(e))
    }
  }

  // Already open (a lock that didn't happen, or Back into this screen): straight in. Otherwise the fingerprint asks first.
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (isOpen(id)) router.replace({ pathname: "/vault/[id]", params: { id, name } })
    else if (bio) fingerprint()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, [])

  const submit = async () => {
    if (!secret.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const keys = await api.get<VaultResponse>(`/vaults/${id}`)
      // The key derivation takes a second or two on purpose.
      const ok = await vn.vaultUnlock(api.id, id, JSON.stringify({ salt: keys.salt, wrapped: keys.wrapped, recoveryWrapped: keys.recoveryWrapped, kdf: keys.kdf }), recovery ? secret.trim() : secret, recovery ? "recovery" : "passphrase")
      if (ok) enter(recovery)
      else setError(recovery ? "That recovery code doesn't open this vault." : "That passphrase doesn't open this vault.")
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <VaultShell>
      <Page title={name} caption="Locked">
        <View style={{ alignItems: "center", paddingVertical: 8 }}>
          <Lock size={40} color={c.mutedForeground} />
        </View>
        <Field
          key={recovery ? "r" : "p"}
          label={recovery ? "Recovery code" : "Passphrase"}
          secret={!recovery}
          value={secret}
          onChangeText={setSecret}
          autoFocus={!bio}
          autoCapitalize={recovery ? "characters" : "none"}
          autoCorrect={false}
          returnKeyType="done"
          error={error}
          hint={recovery ? "The code you saved when you made the vault. You'll set a new passphrase next." : undefined}
          onSubmitEditing={submit}
        />
        <Button label="Unlock" busy={busy} disabled={!secret.trim()} onPress={submit} />
        {bio && !recovery && <Button variant="outlined" label="Use fingerprint" icon={<Fingerprint size={20} color={c.foreground} />} onPress={fingerprint} />}
        <Button
          variant="text"
          label={recovery ? "Use passphrase" : "Use recovery code"}
          onPress={() => {
            setRecovery(!recovery)
            setSecret("")
            setError(null)
          }}
        />
      </Page>
    </VaultShell>
  )
}
