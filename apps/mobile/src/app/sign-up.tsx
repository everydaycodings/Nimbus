import { useLocalSearchParams } from "expo-router"
import { useRef, useState } from "react"
import { View } from "react-native"

import { offerLockIfNew } from "@/components/lock"
import { ConfirmServer } from "@/components/server-confirm"
import { Button, ErrorText, Field, FormScreen, Text, type InputRef } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { ApiError, errorText, send } from "@/lib/api"
import { c } from "@/lib/theme"

export default function SignUpRoute() {
  const { server } = useLocalSearchParams<{ server: string }>()
  return (
    <ConfirmServer server={server}>
      <SignUp />
    </ConfirmServer>
  )
}

function SignUp() {
  const { server, mode } = useLocalSearchParams<{ server: string; mode: string }>()
  const { add } = useAccounts()
  const emailField = useRef<InputRef>(null)
  const passwordField = useRef<InputRef>(null)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [invite, setInvite] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function go() {
    setBusy(true)
    setError(null)
    try {
      // People paste the whole invite link; the server only wants its token.
      const token = invite.trim().split("/").pop()
      const r = await send(server, "/api/auth/sign-up/email", {
        method: "POST",
        headers: token ? { cookie: `nimbus_invite=${encodeURIComponent(token)}` } : undefined,
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok) throw new ApiError(r.status, body?.code ?? "error", body?.message ?? "Couldn't create the account.")
      const session = r.headers.get("set-auth-token")
      if (!session) throw new Error("Account created. Go back and sign in.")
      await add(server, session)
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
        <Text variant="headline">Create your account</Text>
        <Text color={c.mutedForeground}>
          {mode === "approval" ? "An admin of this Nimbus approves new accounts before they can store files." : server.replace(/^https?:\/\//, "")}
        </Text>
      </View>
      <View style={{ gap: 16 }}>
        <Field label="Name" value={name} onChangeText={setName} autoComplete="name" returnKeyType="next" onSubmitEditing={() => emailField.current?.focus()} />
        <Field ref={emailField} label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="next" onSubmitEditing={() => passwordField.current?.focus()} />
        <Field ref={passwordField} label="Password" value={password} onChangeText={setPassword} secret autoComplete="new-password" returnKeyType={mode === "invite" ? "default" : "go"} onSubmitEditing={() => mode !== "invite" && name.trim() && email.trim() && password && go()} />
        {mode === "invite" && (
          <Field label="Invite link" value={invite} onChangeText={setInvite} autoCapitalize="none" autoCorrect={false} hint="Paste the link you were sent." />
        )}
      </View>
      {error && <ErrorText>{error}</ErrorText>}
      <Button label="Create account" onPress={go} busy={busy} disabled={!name.trim() || !email.trim() || !password || (mode === "invite" && !invite.trim())} />
    </FormScreen>
  )
}
