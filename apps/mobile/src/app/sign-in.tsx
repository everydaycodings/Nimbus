import { router, useLocalSearchParams } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import { useEffect, useRef, useState } from "react"
import { Pressable, View } from "react-native"
import { Fingerprint, GithubLogo, GoogleLogo, Key, QrCode } from "phosphor-react-native"

import { Button, ErrorText, Field, FormScreen, Spinner, Text, type InputRef } from "@/components/ui"
import { whilePicking } from "@/lib/picking"
import { useAccounts } from "@/lib/accounts"
import { passkeysSupported, signInWithPasskey } from "@/lib/passkeys"
import { ApiError, connect, cookiesFrom, errorText, json, send, type Instance } from "@/lib/api"
import { offerLockIfNew } from "@/components/lock"
import { ConfirmServer, InsecureWarning } from "@/components/server-confirm"
import { c } from "@/lib/theme"

const RETURN = "nimbus://auth"

export default function SignInRoute() {
  const { server } = useLocalSearchParams<{ server: string }>()
  return (
    <ConfirmServer server={server}>
      <SignIn />
    </ConfirmServer>
  )
}

function SignIn() {
  const { server } = useLocalSearchParams<{ server: string }>()
  const { add } = useAccounts()
  const [instance, setInstance] = useState<Instance | null>(null)
  const passwordField = useRef<InputRef>(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    connect(server)
      .then((r) => setInstance(r.instance))
      .catch((e) => setError(errorText(e)))
  }, [server])

  async function finish(token: string) {
    await add(server, token)
    await offerLockIfNew()
  }

  async function withPasskey() {
    setBusy("passkey")
    setError(null)
    try {
      const token = await signInWithPasskey(server)
      if (token) await finish(token)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  async function withPassword() {
    setBusy("password")
    setError(null)
    try {
      const r = await send(server, "/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok) throw new ApiError(r.status, body?.code ?? "error", body?.message ?? "Couldn't sign in. Try again.")
      if (body?.twoFactorRedirect) {
        router.push({
          pathname: "/two-factor",
          params: { server, cookie: cookiesFrom(r.headers.get("set-cookie")), passkeys: instance?.passkeys ? "1" : "" },
        })
        return
      }
      const token = r.headers.get("set-auth-token")
      if (!token) throw new Error("The server didn't start a session. Try again.")
      await finish(token)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  // Better Auth's Expo flow: ask for the provider's URL, open it through the
  // server's proxy so the browser holds the state, and read the deep link back.
  async function withProvider(provider: string) {
    setBusy(provider)
    setError(null)
    try {
      const r = await send(server, "/api/auth/sign-in/social", {
        method: "POST",
        body: JSON.stringify({ provider, callbackURL: RETURN }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok || !body?.url) throw new ApiError(r.status, "error", body?.message ?? "Couldn't start that sign-in.")
      const state = /(?:^|;\s*)(?:__Secure-)?[\w.-]*oauth_state=([^;]+)/.exec(cookiesFrom(r.headers.get("set-cookie")))
      const q = new URLSearchParams({ authorizationURL: body.url })
      if (state) q.set("oauthState", decodeURIComponent(state[1]))
      const done = await whilePicking(() => WebBrowser.openAuthSessionAsync(
        `${server}/api/auth/${body.url.startsWith("http:") ? "app-authorize" : "expo-authorization-proxy"}?${q}`,
        RETURN
      ))
      if (done.type !== "success") return
      const url = new URL(done.url)
      const code = url.searchParams.get("code")
      if (!code) throw new Error(url.searchParams.get("error")?.replaceAll("_", " ") ?? "That sign-in didn't finish. Try again.")
      // The deep link carries a one-time code, not the session: trade it with the server.
      const { token } = await json<{ token: string }>(server, "/api/auth/app-return/exchange", { method: "POST", body: JSON.stringify({ code }) })
      // twofa: the account has two-factor, so the code holds the pending sign-in's cookie instead.
      if (url.searchParams.get("twofa") === "1") {
        router.push({ pathname: "/two-factor", params: { server, cookie: token, passkeys: instance?.passkeys ? "1" : "" } })
        return
      }
      await finish(token)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  if (!instance && !error) return <Spinner />
  const p = instance?.providers
  const httpOnly = server.startsWith("http://")
  const usePasskey = Boolean(instance?.passkeys && passkeysSupported && !p?.only)
  return (
    <FormScreen>
      <View style={{ gap: 8 }}>
        <Text variant="headline">Sign in</Text>
        <Text color={c.mutedForeground} numberOfLines={1}>{server.replace(/^https?:\/\//, "")}</Text>
      </View>
      {httpOnly && <InsecureWarning />}
      {!p?.only && instance && (
        <View style={{ gap: 16 }}>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="next" onSubmitEditing={() => passwordField.current?.focus()} />
          <Field ref={passwordField} label="Password" value={password} onChangeText={setPassword} secret autoComplete="current-password" returnKeyType="go" onSubmitEditing={withPassword} />
          {instance.email && (
            <Pressable onPress={() => WebBrowser.openBrowserAsync(`${server}/forgot-password`)} accessibilityRole="link" style={{ alignSelf: "flex-start", minHeight: 48, justifyContent: "center" }}>
              <Text variant="label" color={c.mutedForeground}>Forgot password?</Text>
            </Pressable>
          )}
          <Button label="Sign in" onPress={withPassword} busy={busy === "password"} disabled={!email.trim() || !password} />
        </View>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {p && (p.google || p.github || p.oidc || usePasskey) && (
        <View style={{ gap: 12 }}>
          {usePasskey && <Button variant="outlined" label="Sign in with a passkey" icon={<Fingerprint size={20} color={c.foreground} />} busy={busy === "passkey"} onPress={withPasskey} />}
          {p.google && <Button variant="outlined" label="Continue with Google" icon={<GoogleLogo size={20} color={c.foreground} />} busy={busy === "google"} onPress={() => withProvider("google")} />}
          {p.github && <Button variant="outlined" label="Continue with GitHub" icon={<GithubLogo size={20} color={c.foreground} />} busy={busy === "github"} onPress={() => withProvider("github")} />}
          {p.oidc && <Button variant="outlined" label={`Continue with ${p.oidc.name}`} icon={<Key size={20} color={c.foreground} />} busy={busy === "oidc"} onPress={() => withProvider("oidc")} />}
        </View>
      )}
      {instance?.deviceLinks && (
        <View style={{ gap: 12 }}>
          <Button variant="outlined" label="Scan QR code" icon={<QrCode size={20} color={c.foreground} />} onPress={() => router.push("/scan")} />
          <Button variant="outlined" label="Use a code from your computer" onPress={() => router.push({ pathname: "/link", params: { server } })} />
        </View>
      )}
      {instance && instance.signupMode !== "closed" && !p?.only && (
        <Button variant="text" label="Create an account" onPress={() => router.push({ pathname: "/sign-up", params: { server, mode: instance.signupMode } })} />
      )}
    </FormScreen>
  )
}
