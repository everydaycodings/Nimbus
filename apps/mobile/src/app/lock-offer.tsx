import { View } from "react-native"
import { Fingerprint } from "phosphor-react-native"

import { enterApp, setLock } from "@/components/lock"
import { Button, FormScreen, Text } from "@/components/ui"
import { c } from "@/lib/theme"

export default function LockOffer() {
  const choose = async (on: boolean) => {
    await setLock(on)
    enterApp()
  }
  return (
    <FormScreen>
      <View style={{ gap: 16 }}>
        <Fingerprint size={48} color={c.brand} />
        <Text variant="headline">Lock Nimbus on this phone?</Text>
        <Text color={c.mutedForeground}>
          Ask for your fingerprint, face or screen lock when Nimbus opens, so
          someone holding your unlocked phone can't browse your files. You can
          change this later in More.
        </Text>
      </View>
      <View style={{ gap: 12 }}>
        <Button label="Turn on app lock" onPress={() => choose(true)} />
        <Button variant="text" label="Not now" onPress={() => choose(false)} />
      </View>
    </FormScreen>
  )
}
