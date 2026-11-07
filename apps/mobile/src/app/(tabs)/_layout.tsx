import { Redirect, Tabs } from "expo-router"
import { useWindowDimensions, View } from "react-native"

import { isWide, NavBar } from "@/components/nav"
import { OfflineBar } from "@/components/offline-bar"
import { UploadStrip } from "@/components/upload-strip"
import { useAccounts } from "@/lib/accounts"
import { c } from "@/lib/theme"

// Keyed by account, so nothing in a tab's folder history survives a switch.
export default function TabsLayout() {
  const { active } = useAccounts()
  const { width } = useWindowDimensions()
  if (!active) return <Redirect href="/connect" />
  const wide = isWide(width)
  return (
    <View style={{ flex: 1 }}>
    <Tabs
      key={active.id}
      backBehavior="firstRoute"
      tabBar={(props) => (wide ? <NavBar {...props} /> : <View><OfflineBar /><UploadStrip /><NavBar {...props} /></View>)}
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? "left" : "bottom",
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen name="(files)" />
      <Tabs.Screen name="photos" />
      <Tabs.Screen name="(shared)" />
      <Tabs.Screen name="(starred)" />
      <Tabs.Screen name="more" />
      {/* Recent has no tab: a chip on Files and a row in More open it. */}
      <Tabs.Screen name="(recent)" options={{ href: null }} />
    </Tabs>
    {wide && <View style={{ position: "absolute", bottom: 16, left: 96, width: 360, gap: 8 }}><OfflineBar floating /><UploadStrip floating /></View>}
    </View>
  )
}
