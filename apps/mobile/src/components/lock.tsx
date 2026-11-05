import * as LocalAuthentication from "expo-local-authentication"
import { router } from "expo-router"
import * as SecureStore from "expo-secure-store"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { AppState, View } from "react-native"

import { BrandMark } from "./brand"
import { Button, Text } from "./ui"
import { backupAvailable } from "@/lib/backup"
import { c } from "@/lib/theme"

const KEY = "lock.v1" // "on" | "off"; missing means it hasn't been offered yet
const AFTER_MS = 60_000

export const setLock = (on: boolean) => SecureStore.setItemAsync(KEY, on ? "on" : "off")
export const lockSetting = () => SecureStore.getItemAsync(KEY)

// Every sign-in ends here: the first one offers the app lock, later ones go on.
export async function offerLockIfNew() {
  const [setting, enrolled] = await Promise.all([
    lockSetting(),
    LocalAuthentication.getEnrolledLevelAsync(),
  ])
  if (setting === null && enrolled !== LocalAuthentication.SecurityLevel.NONE)
    router.replace("/lock-offer")
  else enterApp()
}

const BACKUP_OFFER = "backupOffer.v1"

// Clears connect and sign-in out of the history, so Back from Files leaves the
// app instead of returning to them. The very first time, camera backup is offered on the way.
export function enterApp() {
  if (router.canDismiss()) router.dismissAll()
  if (backupAvailable && !SecureStore.getItem(BACKUP_OFFER)) {
    SecureStore.setItem(BACKUP_OFFER, "shown")
    return router.replace("/backup-offer")
  }
  router.replace("/")
}

// Covers the app until the fingerprint or device PIN passes, at launch and after
// a minute in the background.
export function LockGate({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState<boolean | null>(null)
  const away = useRef(0)

  const unlock = useCallback(async () => {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Nimbus" })
    if (r.success) setLocked(false)
  }, [])

  useEffect(() => {
    lockSetting().then((s) => {
      setLocked(s === "on")
      if (s === "on") unlock()
    })
    const sub = AppState.addEventListener("change", async (state) => {
      if (state === "background") away.current = Date.now()
      if (state !== "active" || !away.current) return
      if (Date.now() - away.current > AFTER_MS && (await lockSetting()) === "on") {
        setLocked(true)
        unlock()
      }
      away.current = 0
    })
    return () => sub.remove()
  }, [unlock])

  if (locked === null) return null
  return (
    <>
      {children}
      {locked && (
        <View style={{ position: "absolute", inset: 0, backgroundColor: c.background, alignItems: "center", justifyContent: "center", gap: 24, padding: 24 }}>
          <BrandMark />
          <Text variant="title">Nimbus is locked</Text>
          <Button label="Unlock" onPress={unlock} />
        </View>
      )}
    </>
  )
}
