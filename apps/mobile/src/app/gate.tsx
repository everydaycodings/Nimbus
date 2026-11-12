import { useQuery } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import { Redirect } from "expo-router"
import { useState } from "react"
import { Linking, View } from "react-native"

import { Button, ErrorText, Field, FormScreen, Spinner, Text } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { errorText, json, type Account, type Me } from "@/lib/api"
import { useAuthCall } from "@/lib/files"
import { addPasskey, passkeysSupported } from "@/lib/passkeys"
import { c } from "@/lib/theme"

const useMe = (a: Account | null) =>
  useQuery({
    queryKey: ["me", a?.id],
    enabled: !!a,
    queryFn: () => json<Me>(a!.server, "/api/v1/me", { token: a!.token }),
  })

const post = <T,>(a: Account, path: string, body: object) =>
  json<T>(a.server, path, { method: "POST", token: a.token, body: JSON.stringify(body) })

function SignOut() {
  const { active, remove } = useAccounts()
  return <Button variant="text" label="Sign out" onPress={() => active && remove(active.id)} />
}

function TemporaryPassword({ account, refetch }: { account: Account; refetch: () => void }) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const auth = useAuthCall()
  return (
    <>
      <Text color={c.mutedForeground}>An admin set a temporary password for {account.email}. Replace it with one only you know to continue.</Text>
      <View style={{ gap: 16 }}>
        <Field label="Temporary password" value={current} onChangeText={setCurrent} secret autoComplete="current-password" />
        <Field label="New password" value={next} onChangeText={setNext} secret autoComplete="new-password" error={error} />
      </View>
      <Button label="Save password" busy={busy} disabled={!current || !next} onPress={async () => {
        setBusy(true); setError(null)
        try { await auth("/api/v1/account/password", { current, next }); refetch() }
        catch (e) { setError(errorText(e)) } finally { setBusy(false) }
      }} />
    </>
  )
}

// A QR code is no use on the phone that holds the authenticator, so this hands
// the secret straight to the app, with the key to copy as the fallback.
function TwoFactorSetup({ refetch }: { refetch: () => void }) {
  const auth = useAuthCall()
  const [password, setPassword] = useState("")
  const [uri, setUri] = useState<string | null>(null)
  const [codes, setCodes] = useState<string[]>([])
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  if (!uri)
    return (
      <>
        <Field label="Your password" value={password} onChangeText={setPassword} secret autoComplete="current-password" error={error} />
        <Button label="Continue" busy={busy} disabled={!password} onPress={() => run(async () => {
          const r = await auth<{ totpURI: string; backupCodes: string[] }>("/api/auth/two-factor/enable", { password })
          setUri(r.totpURI); setCodes(r.backupCodes)
        })} />
      </>
    )
  const secret = new URL(uri).searchParams.get("secret") ?? ""
  return (
    <>
      <View style={{ gap: 12 }}>
        <Button variant="outlined" label="Add to authenticator app" onPress={() => Linking.openURL(uri).catch(() => setError("No authenticator app opened. Copy the key instead."))} />
        <Button variant="text" label="Copy key" onPress={() => Clipboard.setStringAsync(secret, { android: { isSensitive: true } })} />
      </View>
      <View style={{ gap: 8 }}>
        <Text variant="label">Save these backup codes</Text>
        <Text variant="caption" color={c.mutedForeground}>Each works once if you lose your phone. They won't be shown again.</Text>
        <View style={{ backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 12 }}>
          <Text selectable style={{ fontFamily: "GeistMono_400Regular", fontSize: 14, lineHeight: 22 }}>{codes.join("\n")}</Text>
        </View>
        <Button variant="text" label="Copy backup codes" onPress={() => Clipboard.setStringAsync(codes.join("\n"), { android: { isSensitive: true } })} />
      </View>
      <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} error={error} />
      <Button label="Turn on two-factor" busy={busy} disabled={code.length !== 6} onPress={() => run(async () => {
        await auth("/api/auth/two-factor/verify-totp", { code })
        refetch()
      })} />
    </>
  )
}

// The same sheet as Account → Passkeys, for when the admin requires one.
function PasskeySetup({ account, refetch }: { account: Account; refetch: () => void }) {
  const [name, setName] = useState("This phone")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!passkeysSupported) return <ErrorText>This version of the app can&apos;t use passkeys. Update the app, or set one up in the browser.</ErrorText>
  return (
    <>
      <Field label="Name" value={name} onChangeText={setName} error={error} />
      <Button label="Add a passkey" busy={busy} disabled={!name.trim()} onPress={async () => {
        setBusy(true); setError(null)
        try { if (await addPasskey(account.server, account.token, name.trim())) refetch() }
        catch (e) { setError(errorText(e)) } finally { setBusy(false) }
      }} />
    </>
  )
}

const TITLE = {
  "temporary-password": "Choose your own password",
  "confirm-email": "Confirm your email",
  pending: "Waiting for approval",
  rejected: "Your request was declined",
  "two-factor": "Set up two-factor to continue",
  passkey: "Set up a passkey to continue",
}

export default function Gate() {
  const { active } = useAccounts()
  const me = useMe(active)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!active) return <Redirect href="/connect" />
  if (!me.data) return <Spinner />
  const gate = me.data.gate
  if (!gate) return <Redirect href="/home" />
  const refetch = () => void me.refetch()
  return (
    <FormScreen>
      <Text variant="headline">{TITLE[gate]}</Text>
      {gate === "temporary-password" && <TemporaryPassword account={active} refetch={refetch} />}
      {gate === "two-factor" && (
        <>
          <Text color={c.mutedForeground}>Your admin requires two-factor on this Nimbus. After your password, you'll also enter a code from an authenticator app.</Text>
          <TwoFactorSetup refetch={refetch} />
        </>
      )}
      {gate === "passkey" && (
        <>
          <Text color={c.mutedForeground}>Your admin requires a passkey on this Nimbus. It lets you sign in with your fingerprint, face or screen lock, and works as your second step.</Text>
          <PasskeySetup account={active} refetch={refetch} />
        </>
      )}
      {gate === "confirm-email" && (
        <>
          <Text color={c.mutedForeground}>We sent a link to {active.email}. Open it to finish setting up your account.</Text>
          {error && <ErrorText>{error}</ErrorText>}
          <Button label="I've confirmed it" busy={me.isFetching} onPress={refetch} />
          <Button variant="outlined" disabled={sent} label={sent ? "Link sent" : "Send the link again"} onPress={async () => {
            try { await post(active, "/api/auth/send-verification-email", { email: active.email }); setSent(true) }
            catch (e) { setError(errorText(e)) }
          }} />
        </>
      )}
      {gate === "pending" && (
        <>
          <Text color={c.mutedForeground}>Your account {active.email} is set up. An admin of this Nimbus needs to approve it before you can store files.</Text>
          <Button variant="outlined" label="Check again" busy={me.isFetching} onPress={refetch} />
        </>
      )}
      {gate === "rejected" && (
        <Text color={c.mutedForeground}>An admin of this Nimbus declined access for {active.email}. If you think that's a mistake, contact the person who runs this server.</Text>
      )}
      <SignOut />
    </FormScreen>
  )
}
