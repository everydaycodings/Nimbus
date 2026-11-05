import * as Clipboard from "expo-clipboard"
import { router, useFocusEffect } from "expo-router"
import { ArrowSquareOut, Copy, ShareNetwork } from "phosphor-react-native"
import { useCallback, useMemo, useState } from "react"
import { BackHandler, Linking, Share, View } from "react-native"
import Svg, { Path } from "react-native-svg"
import { encode } from "uqr"

import { Loaded, Page } from "@/components/page"
import { useSnack } from "@/components/snackbar"
import { Button, ErrorText, Field, Text } from "@/components/ui"
import { errorText } from "@/lib/api"
import { useAccountData, useAuthCall, useFileActions } from "@/lib/files"
import { c, font } from "@/lib/theme"

type Step =
  | { name: "idle" }
  | { name: "password"; purpose: "enable" | "codes" | "disable" }
  | { name: "scan"; uri: string; backupCodes: string[] }
  | { name: "codes"; backupCodes: string[] }

function Qr({ value }: { value: string }) {
  const d = useMemo(() => {
    const { data, size } = encode(value, { border: 0 })
    let path = ""
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y][x]) path += `M${x} ${y}h1v1h-1z`
    return { path, size }
  }, [value])
  return (
    <View accessibilityRole="image" accessibilityLabel="QR code for an authenticator app on another device" style={{ alignSelf: "center", padding: 12, backgroundColor: "#fff", borderRadius: 12 }}>
      <Svg width={192} height={192} viewBox={`0 0 ${d.size} ${d.size}`}>
        <Path d={d.path} fill="#000" />
      </Svg>
    </View>
  )
}

function PasswordStep({ label, submit, danger, onPassword, onCancel }: { label: string; submit: string; danger?: boolean; onPassword: (p: string) => Promise<void>; onCancel: () => void }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      await onPassword(password)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: 16 }}>
      <Field label={label} value={password} onChangeText={setPassword} secret autoFocus autoComplete="current-password" returnKeyType="go" onSubmitEditing={go} error={error} />
      <Button variant={danger ? "outlined" : "filled"} danger={danger} label={submit} busy={busy} disabled={!password} onPress={go} />
      <Button variant="text" label="Cancel" onPress={onCancel} />
    </View>
  )
}

export default function TwoFactor() {
  const account = useAccountData()
  const auth = useAuthCall()
  const actions = useFileActions()
  const snack = useSnack()
  const [step, setStep] = useState<Step>({ name: "idle" })
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const idle = () => setStep({ name: "idle" })

  // Backup codes are shown once, so Back doesn't quietly throw them away.
  const showingCodes = step.name === "codes"
  useFocusEffect(
    useCallback(() => {
      if (!showingCodes) return
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        snack({ text: "Save your backup codes first, then tap “I've saved them”." })
        return true
      })
      return () => sub.remove()
    }, [showingCodes, snack])
  )

  const verify = async (backupCodes: string[]) => {
    setBusy(true)
    setError(null)
    try {
      await auth("/api/auth/two-factor/verify-totp", { code })
      actions.refresh()
      setCode("")
      setStep({ name: "codes", backupCodes })
    } catch {
      setError("That code didn't match. Check the time on your phone and try the newest code.")
    }
    setBusy(false)
  }

  return (
    <Page title="Two-factor authentication" onBack={showingCodes ? null : undefined}>
      <Loaded query={account}>
        {(a) => {
          if (!a.hasPassword)
            return <Text color={c.mutedForeground}>Two-factor protects password sign-ins. For a provider, turn it on in that account instead.</Text>

          if (step.name === "password") {
            const { purpose } = step
            if (purpose === "enable")
              return (
                <PasswordStep
                  label="Confirm your password to start"
                  submit="Continue"
                  onCancel={idle}
                  onPassword={async (password) => {
                    const r = await auth<{ totpURI: string; backupCodes: string[] }>("/api/auth/two-factor/enable", { password })
                    setStep({ name: "scan", uri: r.totpURI, backupCodes: r.backupCodes })
                  }}
                />
              )
            if (purpose === "codes")
              return (
                <View style={{ gap: 16 }}>
                  <Text variant="bodySmall" color={c.mutedForeground}>New codes replace the old ones, which stop working.</Text>
                  <PasswordStep
                    label="Confirm your password"
                    submit="Make new codes"
                    onCancel={idle}
                    onPassword={async (password) => {
                      const r = await auth<{ backupCodes: string[] }>("/api/auth/two-factor/generate-backup-codes", { password })
                      setStep({ name: "codes", backupCodes: r.backupCodes })
                    }}
                  />
                </View>
              )
            return (
              <PasswordStep
                label="Confirm your password to turn off two-factor"
                submit="Turn off two-factor"
                danger
                onCancel={idle}
                onPassword={async (password) => {
                  await auth("/api/auth/two-factor/disable", { password })
                  actions.refresh()
                  snack({ text: "Two-factor is off." })
                  router.back()
                }}
              />
            )
          }

          if (step.name === "scan") {
            const secret = new URL(step.uri).searchParams.get("secret") ?? ""
            return (
              <View style={{ gap: 20 }}>
                <Text color={c.mutedForeground}>Add Nimbus to an authenticator app such as 1Password, Google Authenticator or Aegis.</Text>
                <Button
                  label="Open in authenticator app"
                  icon={<ArrowSquareOut size={18} color={c.primaryForeground} />}
                  onPress={() => Linking.openURL(step.uri).catch(() => snack({ text: "No authenticator app on this phone opened it. Copy the key instead.", error: true }))}
                />
                <View style={{ gap: 8 }}>
                  <Text variant="label">Or enter this key</Text>
                  <Text selectable style={{ fontFamily: font.mono, fontSize: 14, lineHeight: 20 }}>{secret.match(/.{1,4}/g)?.join(" ")}</Text>
                  <View style={{ alignSelf: "flex-start" }}>
                    <Button
                      variant="outlined"
                      label="Copy key"
                      icon={<Copy size={18} color={c.foreground} />}
                      onPress={async () => {
                        await Clipboard.setStringAsync(secret)
                        snack({ text: "Copied the key." })
                      }}
                    />
                  </View>
                </View>
                <View style={{ gap: 8 }}>
                  <Text variant="label">Authenticator on another device? Scan this</Text>
                  <Qr value={step.uri} />
                </View>
                <Field
                  label="Enter the 6-digit code it shows"
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={() => code.length === 6 && verify(step.backupCodes)}
                />
                {error && <ErrorText>{error}</ErrorText>}
                <Button label="Turn on two-factor" busy={busy} disabled={code.length !== 6} onPress={() => verify(step.backupCodes)} />
              </View>
            )
          }

          if (step.name === "codes") {
            const text = step.backupCodes.join("\n")
            return (
              <View style={{ gap: 16 }}>
                <Text variant="titleSmall" accessibilityRole="header">Save your backup codes</Text>
                <Text color={c.mutedForeground}>If you lose your phone, each code gets you in once. Keep them somewhere safe, like a password manager. You won&apos;t see them again.</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", padding: 16, rowGap: 8, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
                  {step.backupCodes.map((b) => (
                    <Text key={b} selectable style={{ width: "50%", fontFamily: font.mono, fontSize: 14, lineHeight: 20 }}>{b}</Text>
                  ))}
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      variant="outlined"
                      label="Copy"
                      icon={<Copy size={18} color={c.foreground} />}
                      onPress={async () => {
                        await Clipboard.setStringAsync(text)
                        snack({ text: "Copied the codes." })
                      }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button variant="outlined" label="Save to…" icon={<ShareNetwork size={18} color={c.foreground} />} onPress={() => Share.share({ message: text }).catch(() => {})} />
                  </View>
                </View>
                <Button label="I've saved them" onPress={() => router.back()} />
              </View>
            )
          }

          if (a.twoFactor)
            return (
              <View style={{ gap: 16 }}>
                <Text color={c.mutedForeground}>Signing in with your password also asks for a code from your authenticator app.</Text>
                <Button variant="outlined" label="New backup codes" onPress={() => setStep({ name: "password", purpose: "codes" })} />
                {a.require2fa ? (
                  <Text variant="bodySmall" color={c.mutedForeground}>Your admin requires two-factor, so it can&apos;t be turned off.</Text>
                ) : (
                  <Button variant="outlined" danger label="Turn off" onPress={() => setStep({ name: "password", purpose: "disable" })} />
                )}
              </View>
            )

          return (
            <View style={{ gap: 16 }}>
              <Text color={c.mutedForeground}>Ask for a code from your phone after your password, so a leaked password alone can&apos;t get in.</Text>
              {a.require2fa && <Text variant="bodySmall">Your admin requires two-factor on this Nimbus.</Text>}
              <Button label="Set up two-factor" onPress={() => setStep({ name: "password", purpose: "enable" })} />
            </View>
          )
        }}
      </Loaded>
    </Page>
  )
}
