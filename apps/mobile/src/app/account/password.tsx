import type { Instance } from "@nimbus/shared/api"
import { router } from "expo-router"
import { useState } from "react"
import { View } from "react-native"

import { Loaded, Page } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, ErrorText, Field, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useAccountData, useAuthCall, useFileActions, useInstance } from "@/lib/files"
import { c } from "@/lib/theme"

// The policy in one line. The server checks it again and has the last word.
function policyHint(p: Instance["passwordPolicy"]) {
  if (!p) return undefined
  const needs = [p.lower && "a lowercase letter", p.upper && "a capital letter", p.digit && "a number", p.symbol && "a symbol"].filter(Boolean)
  return `At least ${p.min} characters${needs.length ? `, with ${needs.join(", ")}` : ""}.`
}

export default function PasswordPage() {
  const account = useAccountData()
  const instance = useInstance()
  const auth = useAuthCall()
  const actions = useFileActions()
  const snack = useSnack()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [again, setAgain] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Only call it a mismatch once they've typed as much as the password.
  const mismatch = again.length >= next.length && again !== next

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await auth("/api/v1/account/password", { current, next })
      actions.refresh()
      snack({ text: "Password changed. Your other devices were signed out." })
      router.back()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Page title="Password">
      <Loaded query={account}>
        {(a) =>
          !a.hasPassword ? (
            <Text color={c.mutedForeground}>You sign in with a provider, so Nimbus doesn&apos;t keep a password for you.</Text>
          ) : (
            <View style={{ gap: 16 }}>
              <Text variant="bodySmall" color={c.mutedForeground}>Changing it signs you out everywhere else.</Text>
              <Field label="Current password" value={current} onChangeText={setCurrent} secret autoComplete="current-password" />
              <Field label="New password" value={next} onChangeText={setNext} secret autoComplete="new-password" hint={policyHint(instance.data?.passwordPolicy ?? null)} />
              <Field
                label="Confirm new password"
                value={again}
                onChangeText={setAgain}
                secret
                autoComplete="new-password"
                error={next && mismatch ? "These don't match yet." : null}
              />
              {error && <ErrorText>{error}</ErrorText>}
              <Button label="Change password" busy={busy} disabled={!current || !next || again !== next} onPress={save} />
            </View>
          )
        }
      </Loaded>
    </Page>
  )
}
