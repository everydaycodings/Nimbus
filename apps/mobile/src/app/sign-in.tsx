import { router, useLocalSearchParams } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import { useEffect, useRef, useState } from "react"
import { Pressable, View } from "react-native"
import { GithubLogo, GoogleLogo, Key, QrCode, WarningCircle } from "phosphor-react-native"

import { Button, ErrorText, Field, FormScreen, Spinner, Text, type InputRef } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { ApiError, connect, cookiesFrom, errorText, send, tokenFromCookies, type Instance } from "@/lib/api"
import { offerLockIfNew } from "@/components/lock"
import { c } from "@/lib/theme"

const RETURN = "nimbus://auth"

export default function SignIn() {
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
          params: { server, cookie: cookiesFrom(r.headers.get("set-cookie")) },
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
      const done = await WebBrowser.openAuthSessionAsync(
        `${server}/api/auth/expo-authorization-proxy?${q}`,
        RETURN
      )
      if (done.type !== "success") return
      const url = new URL(done.url)
      const token = tokenFromCookies(url.searchParams.get("cookie") ?? "")
      if (!token) throw new Error(url.searchParams.get("error")?.replaceAll("_", " ") ?? "That sign-in didn't finish. Try again.")
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
  return (
    <FormScreen>
      <View style={{ gap: 8 }}>
        <Text variant="headline">Sign in</Text>
        <Text color={c.mutedForeground} numberOfLines={1}>{server.replace(/^https?:\/\//, "")}</Text>
      </View>
      {httpOnly && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <WarningCircle size={18} color={c.warning} style={{ marginTop: 1 }} />
          <Text variant="bodySmall" color={c.mutedForeground} style={{ flex: 1 }}>
            This connection isn't encrypted. Only continue on a network you trust.
          </Text>
        </View>
      )}
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
      {(p?.google || p?.github || p?.oidc) && (
        <View style={{ gap: 12 }}>
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
