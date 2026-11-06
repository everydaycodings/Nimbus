import type { VaultResponse } from "@nimbus/shared/api"
import { useQueryClient } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import { Fingerprint, Key, Trash } from "phosphor-react-native"
import { useEffect, useState } from "react"

import { Actions, Frame } from "@/components/dialog"
import { Group, Page, Row, SwitchRow } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, Field, Text } from "@/components/ui"
import { useNeedsUnlock, VaultShell } from "@/components/vault-lock"
import { errorText } from "@/lib/api"
import { useApi } from "@/lib/files"
import { c } from "@/lib/theme"
import { vaultNative, type VaultNative } from "@/lib/vault"

const MIN = 12

export default function Settings() {
  const { id, name, change } = useLocalSearchParams<{ id: string; name?: string; change?: string }>()
  const open = useNeedsUnlock(id, name)
  if (!vaultNative) return <Page title="Vault settings"><Text color={c.mutedForeground}>Vaults need the installed Nimbus app.</Text></Page>
  return <VaultShell>{open && <Body id={id} name={name ?? "Vault"} change={change === "1"} vn={vaultNative} />}</VaultShell>
}

function Body({ id, name, change, vn }: { id: string; name: string; change: boolean; vn: VaultNative }) {
  const api = useApi()
  const snack = useSnack()
  const [available, setAvailable] = useState(false)
  const [bio, setBio] = useState(() => vn.vaultBioEnabled(api.id, id))
  // After a recovery unlock the passphrase has to be replaced.
  const [dialog, setDialog] = useState<"pass" | "delete" | null>(change ? "pass" : null)
  useEffect(() => {
    vn.vaultBioAvailable().then(setAvailable, () => {})
  }, [vn])

  const toggle = async (on: boolean) => {
    try {
      if (on) {
        if ((await vn.vaultBioEnable(api.id, id)) === "ok") setBio(true)
      } else {
        vn.vaultBioDisable(api.id, id)
        setBio(false)
      }
    } catch (e) {
      snack({ text: errorText(e), error: true })
    }
  }

  return (
    <Page title="Vault settings" caption={name}>
      <Group>
        {available ? (
          <SwitchRow label="Unlock with fingerprint" detail="Asks for your fingerprint each time. If a fingerprint is added to this phone, you'll need your passphrase again." value={bio} onChange={toggle} />
        ) : (
          <Row label="Unlock with fingerprint" detail="Set up a fingerprint in Android's settings to use it here." icon={<Fingerprint size={24} color={c.mutedForeground} />} disabled />
        )}
        <Row label="Change passphrase" icon={<Key size={24} color={c.mutedForeground} />} onPress={() => setDialog("pass")} />
      </Group>
      <Group>
        <Row label="Delete vault" detail="Deletes everything in it for good." danger icon={<Trash size={24} color={c.destructive} />} onPress={() => setDialog("delete")} />
      </Group>
      {dialog === "pass" && <PassphraseDialog id={id} vn={vn} recovered={change} onClose={() => setDialog(null)} />}
      {dialog === "delete" && <DeleteDialog id={id} name={name} vn={vn} onClose={() => setDialog(null)} />}
    </Page>
  )
}

function PassphraseDialog({ id, vn, recovered, onClose }: { id: string; vn: VaultNative; recovered: boolean; onClose: () => void }) {
  const api = useApi()
  const snack = useSnack()
  const [pass, setPass] = useState("")
  const [again, setAgain] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = pass.length >= MIN && pass === again
  const submit = async () => {
    if (!ok || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.put(`/vaults/${id}/key`, JSON.parse(await vn.vaultRewrap(api.id, id, pass)))
      snack({ text: "Passphrase changed." })
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Frame title="Change passphrase" onClose={onClose}>
      {recovered && <Text color={c.mutedForeground}>You opened this vault with the recovery code. Choose a new passphrase.</Text>}
      <Field label="New passphrase" secret value={pass} autoFocus autoCapitalize="none" autoCorrect={false} onChangeText={setPass} returnKeyType="next" hint={pass.length < MIN ? `At least ${MIN} characters (${pass.length} so far).` : "Long enough."} />
      <Field label="Repeat new passphrase" secret value={again} autoCapitalize="none" autoCorrect={false} onChangeText={setAgain} returnKeyType="done" onSubmitEditing={submit} error={error ?? (again && pass !== again ? "The passphrases don't match." : null)} />
      <Actions>
        <Button variant="text" label={recovered ? "Later" : "Cancel"} onPress={onClose} />
        <Button label="Change" busy={busy} disabled={!ok} onPress={submit} />
      </Actions>
    </Frame>
  )
}

function DeleteDialog({ id, name, vn, onClose }: { id: string; name: string; vn: VaultNative; onClose: () => void }) {
  const api = useApi()
  const snack = useSnack()
  const client = useQueryClient()
  const [pass, setPass] = useState("")
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = !!pass && typed === name
  const submit = async () => {
    if (!ok || busy) return
    setBusy(true)
    setError(null)
    try {
      const k = await api.get<VaultResponse>(`/vaults/${id}`)
      const right = await vn.vaultUnlock(api.id, id, JSON.stringify({ salt: k.salt, wrapped: k.wrapped, recoveryWrapped: k.recoveryWrapped, kdf: k.kdf }), pass, "passphrase")
      if (!right) return setError("That passphrase doesn't open this vault.")
      await api.del(`/vaults/${id}`)
      vn.vaultForget(api.id, id)
      client.invalidateQueries({ queryKey: [api.id] })
      onClose()
      snack({ text: `Deleted “${name}”.` })
      router.dismissTo("/vault")
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Frame title="Delete this vault?" onClose={onClose}>
      <Text color={c.mutedForeground}>Everything in “{name}” is deleted for good. Nobody can bring it back, not even with the recovery code.</Text>
      <Field label="Passphrase" secret value={pass} autoFocus autoCapitalize="none" autoCorrect={false} onChangeText={setPass} returnKeyType="next" />
      <Field label={`Type “${name}” to confirm`} value={typed} autoCapitalize="none" autoCorrect={false} onChangeText={setTyped} returnKeyType="done" onSubmitEditing={submit} error={error} />
      <Actions>
        <Button variant="text" label="Cancel" onPress={onClose} />
        <Button variant="text" danger label="Delete vault" busy={busy} disabled={!ok} onPress={submit} />
      </Actions>
    </Frame>
  )
}
