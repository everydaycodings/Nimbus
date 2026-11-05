import Constants, { ExecutionEnvironment } from "expo-constants"
import * as WebBrowser from "expo-web-browser"
import { CheckCircle } from "phosphor-react-native"
import { useState } from "react"

import { Group, Loaded, Page, Row } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, ErrorText, Text } from "@/components/ui"
import { ApiError, cookiesFrom, errorText, send } from "@/lib/api"
import { useAccountData, useApi, useAuthCall, useFileActions, useInstance } from "@/lib/files"
import { c } from "@/lib/theme"

const RETURN = "nimbus://auth"
const OIDC = "oidc"
// The nimbus:// return can't reach Expo Go.
const expoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient

export default function Methods() {
  const api = useApi()
  const account = useAccountData()
  const instance = useInstance()
  const auth = useAuthCall()
  const actions = useFileActions()
  const snack = useSnack()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The same Expo flow as sign-in: the provider's URL, opened through the server's
  // proxy so the browser holds the state, then the deep link back.
  const connect = async (provider: string) => {
    setBusy(provider)
    setError(null)
    try {
      const { server, token } = api.account
      const r = await send(server, "/api/auth/link-social", {
        method: "POST",
        token,
        body: JSON.stringify({ provider, callbackURL: RETURN, errorCallbackURL: RETURN }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok || !body?.url) throw new ApiError(r.status, "error", body?.message ?? "Couldn't reach the provider.")
      const state = /(?:^|;\s*)(?:__Secure-)?[\w.-]*oauth_state=([^;]+)/.exec(cookiesFrom(r.headers.get("set-cookie")))
      const q = new URLSearchParams({ authorizationURL: body.url })
      if (state) q.set("oauthState", decodeURIComponent(state[1]))
      const done = await WebBrowser.openAuthSessionAsync(`${server}/api/auth/expo-authorization-proxy?${q}`, RETURN)
      if (done.type !== "success") return
      if (new URL(done.url).searchParams.get("error")) throw new Error("That didn't connect. The provider's email must match this account's.")
      actions.refresh()
      snack({ text: "Connected." })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async (providerId: string, name: string) => {
    setBusy(providerId)
    setError(null)
    try {
      await auth("/api/auth/unlink-account", { providerId })
      actions.refresh()
      snack({ text: `Disconnected ${name}.` })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const p = instance.data?.providers
  return (
    <Page title="Sign-in methods">
      <Text variant="bodySmall" color={c.mutedForeground}>Connect a provider to sign in with it too. Its email must match this account&apos;s.</Text>
      <Loaded query={account}>
        {(a) => {
          const linked = a.linkedProviders
          const last = linked.length <= 1
          // What's turned on, plus anything still linked from before.
          const methods = [
            { id: "google", label: "Google", on: !!p?.google && !p.only },
            { id: "github", label: "GitHub", on: !!p?.github && !p.only },
            { id: OIDC, label: p?.oidc?.name ?? "Single sign-on", on: !!p?.oidc },
          ].filter((m) => m.on || linked.includes(m.id))
          return (
            <Group>
              <Row
                label="Password"
                icon={linked.includes("credential") ? <CheckCircle size={24} weight="fill" color={c.brand} /> : undefined}
                trailing={<Text variant="bodySmall" color={c.mutedForeground}>{linked.includes("credential") ? "Set" : "Not set"}</Text>}
              />
              {methods.map((m) => {
                const on = linked.includes(m.id)
                return (
                  <Row
                    key={m.id}
                    label={m.label}
                    detail={on ? (last ? "It's your only way to sign in." : "Connected") : expoGo ? "Available in the installed app" : null}
                    icon={on ? <CheckCircle size={24} weight="fill" color={c.brand} /> : undefined}
                    trailing={
                      on ? (
                        <Button variant="outlined" label="Disconnect" busy={busy === m.id} disabled={!!busy || last} onPress={() => disconnect(m.id, m.label)} />
                      ) : (
                        <Button variant="outlined" label="Connect" busy={busy === m.id} disabled={!!busy || expoGo} onPress={() => connect(m.id)} />
                      )
                    }
                  />
                )
              })}
            </Group>
          )
        }}
      </Loaded>
      {error && <ErrorText>{error}</ErrorText>}
    </Page>
  )
}
