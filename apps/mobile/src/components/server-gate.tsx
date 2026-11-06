import { router } from "expo-router"
import { useEffect } from "react"
import { AppState, Linking, View } from "react-native"

import { serverName } from "./avatar"
import { BrandMark } from "./brand"
import { Button, Text } from "./ui"
import { useAccounts } from "@/lib/accounts"
import { oldAppText, oldServerText } from "@/lib/api-version"
import { checkServers, useServerInfo } from "@/lib/servers"
import { c } from "@/lib/theme"

// Asks every account's server which API it speaks at launch, when accounts change, and on return to the app.
// When the active account's server is outside what this app understands, covers the app until that's sorted.
export function ServerGate() {
  const { accounts, active, ready, switchTo, remove } = useAccounts()
  const info = useServerInfo(active?.id)
  const key = accounts.map((a) => a.id).join()

  useEffect(() => {
    if (!ready || !accounts.length) return
    checkServers(accounts)
    const sub = AppState.addEventListener("change", (s) => s === "active" && checkServers(accounts))
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the account list
  }, [ready, key])

  if (!active || !info?.problem) return null
  const other = accounts.find((a) => a.id !== active.id)
  const oldApp = info.problem === "old-app"
  return (
    <View style={{ position: "absolute", inset: 0, zIndex: 10, elevation: 10, backgroundColor: c.background, alignItems: "center", justifyContent: "center", gap: 24, padding: 24 }}>
      <BrandMark />
      <View style={{ gap: 8, alignItems: "center" }}>
        <Text variant="title" accessibilityRole="header" style={{ textAlign: "center" }}>
          {oldApp ? "Update the app" : "Your server needs an update"}
        </Text>
        <Text color={c.mutedForeground} style={{ textAlign: "center" }}>{oldApp ? oldAppText(info.instance.apiVersion) : oldServerText(info.instance.apiVersion)}</Text>
        <Text variant="caption" color={c.dim}>{serverName(active.server)} · {active.email}</Text>
      </View>
      <View style={{ gap: 12, alignSelf: "stretch" }}>
        {oldApp && <Button label="Get the update" onPress={() => Linking.openURL(`${active.server}/app`)} />}
        <Button variant={oldApp ? "outlined" : undefined} label="Check again" onPress={() => checkServers(accounts)} />
        {other && (
          <Button
            variant="outlined"
            label="Switch account"
            onPress={async () => {
              await switchTo(other.id)
              router.replace("/")
            }}
          />
        )}
        <Button variant="text" danger label="Sign out" onPress={() => remove(active.id).then(() => router.replace("/"))} />
      </View>
    </View>
  )
}
