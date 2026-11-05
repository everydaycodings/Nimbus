import { Redirect, Tabs } from "expo-router"
import { useWindowDimensions } from "react-native"

import { isWide, NavBar } from "@/components/nav"
import { useAccounts } from "@/lib/accounts"
import { c } from "@/lib/theme"

// Keyed by account, so nothing in a tab's folder history survives a switch.
export default function TabsLayout() {
  const { active } = useAccounts()
  const { width } = useWindowDimensions()
  if (!active) return <Redirect href="/connect" />
  return (
    <Tabs
      key={active.id}
      backBehavior="firstRoute"
      tabBar={(props) => <NavBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: isWide(width) ? "left" : "bottom",
        sceneStyle: { backgroundColor: c.background },
      }}
    >
      <Tabs.Screen name="(files)" />
      <Tabs.Screen name="(recent)" />
      <Tabs.Screen name="(shared)" />
      <Tabs.Screen name="(starred)" />
      <Tabs.Screen name="more" />
    </Tabs>
  )
}
