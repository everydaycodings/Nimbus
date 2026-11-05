import { useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { View } from "react-native"

import { offerLockIfNew } from "@/components/lock"
import { Button, Field, FormScreen, Text } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { ApiError, errorText, send } from "@/lib/api"
import { c } from "@/lib/theme"

export default function TwoFactor() {
  const { server, cookie } = useLocalSearchParams<{ server: string; cookie: string }>()
  const { add } = useAccounts()
  const [code, setCode] = useState("")
  const [backup, setBackup] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function go() {
    setBusy(true)
    setError(null)
    try {
      const r = await send(server, `/api/auth/two-factor/${backup ? "verify-backup-code" : "verify-totp"}`, {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify({ code: code.trim() }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok) throw new ApiError(r.status, body?.code ?? "error", body?.message ?? "That code didn't work. Try again.")
      const token = r.headers.get("set-auth-token")
      if (!token) throw new Error("The server didn't start a session. Go back and sign in again.")
      await add(server, token)
      await offerLockIfNew()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormScreen>
      <View style={{ gap: 8 }}>
        <Text variant="headline">{backup ? "Enter a backup code" : "Enter your code"}</Text>
        <Text color={c.mutedForeground}>
          {backup ? "Use one of the backup codes you saved. Each works once." : "Open your authenticator app and enter the 6-digit code for Nimbus."}
        </Text>
      </View>
      <Field
        label={backup ? "Backup code" : "6-digit code"}
        value={code}
        onChangeText={(t) => { setCode(t); setError(null) }}
        keyboardType={backup ? "default" : "number-pad"}
        autoComplete={backup ? "off" : "one-time-code"}
        autoCapitalize="none"
        autoFocus
        maxLength={backup ? 40 : 6}
        error={error}
        onSubmitEditing={go}
      />
      <Button label="Verify" onPress={go} busy={busy} disabled={backup ? !code.trim() : code.length !== 6} />
      <Button variant="text" label={backup ? "Use my authenticator app" : "Use a backup code"} onPress={() => { setBackup(!backup); setCode(""); setError(null) }} />
    </FormScreen>
  )
}
