import { Stack } from "expo-router"
import { useReducedMotion } from "react-native-reanimated"

import { TabContext, type TabGroup } from "@/lib/tab"
import { c } from "@/lib/theme"

export const unstable_settings = { anchor: "home" }

// One copy of this per tab, so each tab keeps its own folder history.
export default function TabStack({ segment }: { segment: string }) {
  const still = useReducedMotion()
  return (
    <TabContext value={segment as TabGroup}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: still ? "none" : "slide_from_right",
          contentStyle: { backgroundColor: c.background },
        }}
      />
    </TabContext>
  )
}
