import { CameraView, useCameraPermissions } from "expo-camera"
import { router } from "expo-router"
import { useRef, useState } from "react"
import { Linking, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button, ErrorText, FormScreen, Text } from "@/components/ui"
import { parseLink } from "@/lib/api"
import { c, radius } from "@/lib/theme"

export default function Scan() {
  const [permission, ask] = useCameraPermissions()
  const inset = useSafeAreaInsets()
  const [error, setError] = useState<string | null>(null)
  const handled = useRef(false)

  if (!permission) return null
  if (!permission.granted)
    return (
      <FormScreen>
        <Text variant="headline">Use the camera to scan</Text>
        <Text color={c.mutedForeground}>
          Nimbus only uses the camera to read the sign-in QR code on your computer.
        </Text>
        <Button
          label={permission.canAskAgain ? "Allow camera" : "Open settings"}
          onPress={() => (permission.canAskAgain ? ask() : Linking.openSettings())}
        />
        <Button variant="text" label="Back" onPress={() => router.back()} />
      </FormScreen>
    )

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return
          const link = parseLink(data)
          if (!link) {
            setError("That isn't a Nimbus sign-in code.")
            return
          }
          handled.current = true
          router.replace({ pathname: "/link", params: link })
        }}
      />
      <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 240, height: 240, borderWidth: 2, borderColor: c.brand, borderRadius: radius.card * 2 }} />
      </View>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 24, paddingBottom: inset.bottom + 24, gap: 12, backgroundColor: "rgba(10,10,10,0.85)" }}>
        <Text variant="titleSmall">Point at the QR code on your computer</Text>
        {error ? <ErrorText>{error}</ErrorText> : (
          <Text variant="bodySmall" color={c.mutedForeground}>
            Find it in Nimbus under Account, Sign in on your phone.
          </Text>
        )}
        <Button variant="outlined" label="Cancel" onPress={() => router.back()} />
      </View>
    </View>
  )
}
