import { router } from "expo-router"
import { QrCode } from "phosphor-react-native"
import { useState } from "react"
import { View } from "react-native"

import { BrandMark } from "@/components/brand"
import { Button, Field, FormScreen, Text } from "@/components/ui"
import { connect, errorText } from "@/lib/api"
import { c } from "@/lib/theme"

export default function Connect() {
  const [address, setAddress] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function go() {
    setBusy(true)
    setError(null)
    try {
      const { server } = await connect(address)
      router.push({ pathname: "/sign-in", params: { server } })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormScreen>
      <View style={{ gap: 16 }}>
        <BrandMark />
        <Text variant="headline">Connect to your Nimbus</Text>
        <Text color={c.mutedForeground}>
          On your computer, open Nimbus and go to Account, then Sign in on your
          phone. Scan the QR code it shows.
        </Text>
      </View>
      <Button
        label="Scan QR code"
        icon={<QrCode size={20} color={c.primaryForeground} />}
        onPress={() => router.push("/scan")}
      />
      <View style={{ height: 1, backgroundColor: c.border }} />
      <Field
        label="Server address"
        placeholder="files.example.net"
        value={address}
        onChangeText={(t) => {
          setAddress(t)
          setError(null)
        }}
        onSubmitEditing={go}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="url"
        keyboardType="url"
        returnKeyType="go"
        error={error}
      />
      <Button variant="outlined" label="Continue" onPress={go} busy={busy} disabled={!address.trim()} />
    </FormScreen>
  )
}
