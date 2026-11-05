import { formatBytes } from "@nimbus/shared/file-rules"
import { CloudArrowUp } from "phosphor-react-native"
import { useState } from "react"
import { Pressable, View } from "react-native"

import { enterApp } from "@/components/lock"
import { Button, FormScreen, Text } from "@/components/ui"
import { useAccounts } from "@/lib/accounts"
import { askForMedia, saveSettings } from "@/lib/backup"
import type { Album } from "@/lib/backup-rules"
import { native } from "@/lib/native"
import { c, radius } from "@/lib/theme"

// Offered once, after the first sign-in. Step one asks; step two, once Android lets us count, picks a start.
export default function BackupOffer() {
  const { active } = useAccounts()
  const [camera, setCamera] = useState<Album | null>(null)
  const [step, setStep] = useState<"ask" | "from">("ask")
  const [older, setOlder] = useState(false)
  const [denied, setDenied] = useState(false)

  const turnOn = async () => {
    if (!(await askForMedia())) return setDenied(true)
    const albums: Album[] = JSON.parse((await native?.backupAlbums()) ?? "[]")
    const cam = albums.find((a) => a.camera) ?? null
    if (!cam?.count) return finish(false)
    setCamera(cam)
    setStep("from")
  }

  const finish = (all: boolean) => {
    saveSettings({ enabled: true, accountId: active?.id ?? null, from: all ? 0 : Date.now() })
    enterApp()
  }

  if (step === "from" && camera)
    return (
      <FormScreen>
        <View style={{ gap: 16 }}>
          <Text variant="headline">Back up from when?</Text>
          {[
            { all: false, label: "From now on", detail: "Only photos and videos you take from today" },
            { all: true, label: `Also back up ${camera.count.toLocaleString()} older items`, detail: `${formatBytes(camera.bytes)} already in your camera` },
          ].map((o) => (
            <Pressable
              key={o.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: older === o.all }}
              onPress={() => setOlder(o.all)}
              android_ripple={{ color: c.ripple }}
              style={{ padding: 16, gap: 4, borderWidth: 1, borderRadius: radius.card, borderColor: older === o.all ? c.brand : c.border, backgroundColor: older === o.all ? c.brandWash : undefined }}
            >
              <Text>{o.label}</Text>
              <Text variant="bodySmall" color={c.mutedForeground}>{o.detail}</Text>
            </Pressable>
          ))}
        </View>
        <Button label="Start backup" onPress={() => finish(older)} />
      </FormScreen>
    )

  return (
    <FormScreen>
      <View style={{ gap: 16 }}>
        <CloudArrowUp size={48} color={c.brand} />
        <Text variant="headline">Back up your photos?</Text>
        <Text color={c.mutedForeground}>
          Photos and videos you take are copied to Camera in My files on {active?.server.replace(/^https?:\/\//, "") ?? "your server"}, sorted by year
          and month. It waits for Wi-Fi unless you change that, and nothing is removed from this phone. You can change this later in More.
        </Text>
        {denied && <Text color={c.destructive}>Nimbus can't back up without access to your photos and videos. You can allow it in Android's settings.</Text>}
      </View>
      <View style={{ gap: 12 }}>
        <Button label="Turn on backup" onPress={turnOn} />
        <Button variant="text" label="Not now" onPress={() => enterApp()} />
      </View>
    </FormScreen>
  )
}
