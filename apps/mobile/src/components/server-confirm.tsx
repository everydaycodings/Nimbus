import { router } from "expo-router"
import { WarningCircle } from "phosphor-react-native"
import { useState, type ReactNode } from "react"
import { View } from "react-native"

import { Button, FormScreen, Text } from "./ui"
import { isTrustedServer, trustServer } from "@/lib/api"
import { c } from "@/lib/theme"

export function InsecureWarning() {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <WarningCircle size={18} color={c.warning} style={{ marginTop: 1 }} />
      <Text variant="bodySmall" color={c.mutedForeground} style={{ flex: 1 }}>
        This connection isn't encrypted. Only continue on a network you trust.
      </Text>
    </View>
  )
}

// A nimbus:// link from another app can name any server. Until the person confirms the
// address, nothing is sent to it. Servers typed, scanned or saved in the app skip this.
export function ConfirmServer({ server, children }: { server?: string; children: ReactNode }) {
  const [ok, setOk] = useState(!server || isTrustedServer(server))
  if (ok) return children
  let origin = server!
  try {
    origin = new URL(server!).origin
  } catch {}
  return (
    <FormScreen>
      <View style={{ gap: 8 }}>
        <Text variant="headline">Sign in to {origin}?</Text>
        <Text color={c.mutedForeground}>
          A link outside Nimbus asked to sign in to this server. Only continue if you trust it and expected this.
        </Text>
      </View>
      {origin.startsWith("http://") && <InsecureWarning />}
      <Button label="Continue" onPress={() => { trustServer(server!); setOk(true) }} />
      <Button variant="text" label="Cancel" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
    </FormScreen>
  )
}
