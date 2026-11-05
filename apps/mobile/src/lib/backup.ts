// Camera backup, run by Kotlin. These hooks read and change it; Expo Go has none of it.
import { useFocusEffect } from "expo-router"
import { useCallback, useEffect, useState } from "react"
import { AppState, PermissionsAndroid, Platform } from "react-native"

import { DEFAULT_SETTINGS, type Album, type BackupSettings, type BackupStatus } from "./backup-rules"
import { native as module } from "./native"

// An installed app from before backup existed has the module without these.
const native = typeof module?.backupSettings === "function" ? module : null
export const backupAvailable = !!native

const OFF: BackupStatus = { state: "off", done: 0, total: 0, failed: [], access: "none" }

export const readSettings = (): BackupSettings => ({ ...DEFAULT_SETTINGS, ...JSON.parse(native?.backupSettings() || "{}") })

export function saveSettings(change: Partial<BackupSettings>) {
  const next = { ...readSettings(), ...change }
  native?.setBackup(JSON.stringify(next))
  return next
}

// Photos, videos and their location. Android strips GPS from photos without ACCESS_MEDIA_LOCATION.
export async function askForMedia() {
  if (Platform.OS !== "android") return false
  const v = Platform.Version as number
  const wanted =
    v >= 33
      ? ["android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO", "android.permission.ACCESS_MEDIA_LOCATION"]
      : ["android.permission.READ_EXTERNAL_STORAGE", "android.permission.ACCESS_MEDIA_LOCATION"]
  const got = await PermissionsAndroid.requestMultiple(wanted as never)
  if (v >= 33) PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS").catch(() => {})
  // Android 14's "Allow limited access" still lets backup see what was picked.
  return Object.values(got).some((r) => r === "granted")
}

// Settings and status, kept fresh while the screen is up.
export function useBackup() {
  const [settings, setSettings] = useState<BackupSettings>(() => (native ? readSettings() : DEFAULT_SETTINGS))
  const [status, setStatus] = useState<BackupStatus>(OFF)
  const refresh = useCallback(async () => {
    if (!native) return
    setSettings(readSettings())
    setStatus(JSON.parse(await native.backupStatus()))
  }, [])
  useFocusEffect(
    useCallback(() => {
      refresh()
      if (!native) return
      const sub = native.addListener("backup", () => refresh())
      const app = AppState.addEventListener("change", (s) => s === "active" && refresh())
      return () => {
        sub.remove()
        app.remove()
      }
    }, [refresh])
  )
  const change = useCallback((c: Partial<BackupSettings>) => {
    setSettings(saveSettings(c))
    setTimeout(refresh, 300)
  }, [refresh])
  return { settings, status, change, refresh }
}

export function useAlbums() {
  const [albums, setAlbums] = useState<Album[] | null>(null)
  useEffect(() => {
    native?.backupAlbums().then((j) => setAlbums(JSON.parse(j)))
  }, [])
  return albums
}
