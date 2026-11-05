import { useLocalSearchParams, router } from "expo-router"
import { DeviceMobile } from "phosphor-react-native"
import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, Platform, View } from "react-native"

import { offerLockIfNew } from "@/components/lock"
import { Button, ErrorText, Field, FormScreen, Text } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { ApiError, connect, errorText, json, send } from "@/lib/api"
import { c } from "@/lib/theme"

const deviceName = () =>
  String((Platform.constants as { Model?: string }).Model ?? "Android phone")

// Reached three ways: the in-app scanner, the phone's own camera opening a
// nimbus://link address, and "Use a code", which arrives with no token.
export default function Link() {
  const params = useLocalSearchParams<{ server?: string; token?: string }>()
  const { add } = useAccounts()
  const [server, setServer] = useState(params.server ?? "")
  const [code, setCode] = useState("")
  const [waitingFor, setWaitingFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = useCallback(
    async (address: string, secret: { token?: string; code?: string }) => {
      setBusy(true)
      setError(null)
      try {
        if (/^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/i.test(address.trim()))
          throw new Error("This code points to localhost, which means this phone itself. On your computer, enter its network address on the Account page and scan the new code.")
        // Checks it really is a Nimbus first, the same as a typed address.
        const { server: found } = await connect(address)
        const { pollSecret } = await json<{ pollSecret: string }>(found, "/api/auth/device-link/claim", {
          method: "POST",
          body: JSON.stringify({ ...secret, deviceName: deviceName() }),
        })
        setWaitingFor(found)
        const body = JSON.stringify({ pollSecret })
        while (alive.current) {
          const { status } = await json<{ status: string }>(found, "/api/auth/device-link/poll", { method: "POST", body })
          if (status === "approved") break
          if (status === "denied") throw new Error("Sign-in was denied on your computer.")
          if (status !== "pending-approval") throw new Error("That took too long. Get a new code and try again.")
          await new Promise((r) => setTimeout(r, 2000))
        }
        if (!alive.current) return
        const r = await send(found, "/api/auth/device-link/finish", { method: "POST", body })
        const token = r.headers.get("set-auth-token")
        if (!r.ok || !token) throw new ApiError(r.status, "error", "That sign-in has expired. Get a new code and try again.")
        await add(found, token)
        await offerLockIfNew()
      } catch (e) {
        if (alive.current) {
          setWaitingFor(null)
          setError(errorText(e))
        }
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [add]
  )

  // A scanned or tapped link starts by itself, once.
  const started = useRef(false)
  useEffect(() => {
    if (started.current || !params.server || !params.token) return
    started.current = true
    run(params.server, { token: params.token })
  }, [params.server, params.token, run])

  if (waitingFor)
    return (
      <FormScreen>
        <View style={{ gap: 16 }}>
          <DeviceMobile size={48} color={c.brand} />
          <Text variant="headline">Approve on your computer</Text>
          <Text color={c.mutedForeground}>
            Nimbus is asking whether to allow {deviceName()}. Choose Allow on your Account page to finish.
          </Text>
          <Text variant="bodySmall" color={c.mutedForeground}>
            Signing in to {waitingFor.replace(/^https?:\/\//, "")}
          </Text>
        </View>
        <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Waiting for approval" />
        <Button variant="text" label="Cancel" onPress={() => router.back()} />
      </FormScreen>
    )

  if (params.token)
    return (
      <FormScreen>
        <Text variant="headline">{error ? "Couldn't sign in" : "Connecting"}</Text>
        {error ? <ErrorText>{error}</ErrorText> : <ActivityIndicator color={c.mutedForeground} accessibilityLabel="Connecting" />}
        {error && <Button label="Scan again" onPress={() => router.replace("/scan")} />}
        <Button variant="text" label="Back" onPress={() => router.back()} />
      </FormScreen>
    )

  return (
    <FormScreen>
      <View style={{ gap: 8 }}>
        <Text variant="headline">Use a code</Text>
        <Text color={c.mutedForeground}>
          On your computer, open Nimbus and go to Account, then Sign in on your phone. It shows the server and code.
        </Text>
      </View>
      <View style={{ gap: 16 }}>
        {!params.server && (
          <Field label="Server address" placeholder="files.example.net" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="next" />
        )}
        <Field label="Code" placeholder="ABCD-2345" value={code} onChangeText={(t) => { setCode(t.toUpperCase()); setError(null) }} autoCapitalize="characters" autoCorrect={false} autoFocus={!!params.server} maxLength={9} returnKeyType="go" onSubmitEditing={() => run(server, { code })} error={error} />
      </View>
      <Button label="Continue" busy={busy} disabled={!server.trim() || code.replace("-", "").length !== 8} onPress={() => run(server, { code })} />
      <Button variant="text" label="Back" onPress={() => router.back()} />
    </FormScreen>
  )
}
