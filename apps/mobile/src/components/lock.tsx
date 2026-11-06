import * as LocalAuthentication from "expo-local-authentication"
import { router } from "expo-router"
import * as SecureStore from "expo-secure-store"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { AppState, BackHandler, Modal, View } from "react-native"

import { BrandMark } from "./brand"
import { Button, Text } from "./ui"
import { backupAvailable } from "@/lib/backup"
import { native } from "@/lib/native"
import { isPicking } from "@/lib/picking"
import { c } from "@/lib/theme"

const KEY = "lock.v1" // "on" | "off"; missing means it hasn't been offered yet
const AFTER_MS = 60_000
// The Files app keeps listing Nimbus this long after the app was last used, longer than the app's own lock.
const FILES_GRACE_MS = Math.max(AFTER_MS, 5 * 60_000)

// The Files app provider hides its roots while the lock is on and the app hasn't been used within the
// timeout. Optional: an installed app from before Phase 6 doesn't have these.
type LockNative = { setUnlockedAt?: (at: number, timeoutMs: number | null) => void; lockNow?: () => void }
const lockNative = native as LockNative | null
const unlocked = (lockOn: boolean) => {
  if (typeof lockNative?.setUnlockedAt === "function") lockNative.setUnlockedAt(Date.now(), lockOn ? FILES_GRACE_MS : null)
}
const locked_ = () => {
  if (typeof lockNative?.lockNow === "function") lockNative.lockNow()
}

export const setLock = async (on: boolean) => {
  await SecureStore.setItemAsync(KEY, on ? "on" : "off")
  unlocked(on)
}
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
  const lockedRef = useRef(true)

  const unlock = useCallback(async () => {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Nimbus" })
    if (r.success) {
      setLocked(false)
      unlocked(true)
    }
  }, [])

  useEffect(() => {
    lockSetting().then((s) => {
      setLocked(s === "on")
      if (s === "on") {
        locked_()
        unlock()
      } else unlocked(false)
    })
    const sub = AppState.addEventListener("change", async (state) => {
      if (state === "background") {
        away.current = Date.now()
        // The last moment of use, which the timeout counts from.
        if (!lockedRef.current) unlocked((await lockSetting()) === "on")
      }
      if (state !== "active" || !away.current) return
      if (Date.now() - away.current > AFTER_MS && !isPicking() && (await lockSetting()) === "on") {
        setLocked(true)
        locked_()
        unlock()
      } else unlocked((await lockSetting()) === "on")
      away.current = 0
    })
    return () => sub.remove()
  }, [unlock])

  lockedRef.current = locked !== false
  if (locked === null) return null
  return (
    <>
      {/* Hidden from TalkBack while locked: the overlay only covers the screen, not the accessibility tree. */}
      <View style={{ flex: 1 }} importantForAccessibility={locked ? "no-hide-descendants" : "auto"} accessibilityElementsHidden={!!locked}>
        {children}
      </View>
      {/* A Modal is its own window: an absolute View over the native screens wasn't in the accessibility tree, so TalkBack read the app behind it. */}
      {locked && (
        <Modal visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={() => BackHandler.exitApp()}>
          <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: c.background, alignItems: "center", justifyContent: "center", gap: 24, padding: 24 }}>
            <BrandMark />
            <Text variant="title" accessibilityRole="header">Nimbus is locked</Text>
            <Button label="Unlock" onPress={unlock} />
          </View>
        </Modal>
      )}
    </>
  )
}
