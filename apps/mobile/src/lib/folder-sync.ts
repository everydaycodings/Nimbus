// Folder backup and sync and Save to device, run by Kotlin. These hooks read and change them; Expo Go has none of it.
import type { Item } from "@nimbus/shared/api"
import { Directory } from "expo-file-system"
import { useFocusEffect } from "expo-router"
import { useCallback, useState } from "react"
import { AppState } from "react-native"

import { DEFAULT_RULES, type SyncFailure, type SyncPair, type SyncRules } from "./folder-sync-rules"
import { native as module } from "./native"
import { whilePicking } from "./picking"

const native = typeof module?.syncPairs === "function" ? module : null
export const syncAvailable = !!native

export const pickPhoneFolder = async () => {
  try {
    const dir = await whilePicking(() => Directory.pickDirectoryAsync())
    return { uri: dir.uri, name: decodeURIComponent(dir.uri).split(/[/:]/).filter(Boolean).pop() ?? "Folder" }
  } catch {
    return null // Backed out of the picker.
  }
}

// "Save to device…": pick a folder, then the app copies in the background and says when it's done.
export async function saveToDevice(accountId: string, items: Item[]) {
  if (!native) return false
  const dir = await pickPhoneFolder()
  if (!dir) return false
  native.exportToDevice?.(accountId, dir.uri, JSON.stringify(items.map((i) => ({ id: i.id, name: i.name, kind: i.kind }))))
  return true
}

export function useFolderSync() {
  const [pairs, setPairs] = useState<SyncPair[]>([])
  const [failures, setFailures] = useState<SyncFailure[]>([])
  const [rules, setRules] = useState<SyncRules>(DEFAULT_RULES)
  const refresh = useCallback(() => {
    if (!native) return
    setPairs(JSON.parse(native.syncPairs!()))
    setFailures(JSON.parse(native.syncFailures!()))
    setRules({ ...DEFAULT_RULES, ...JSON.parse(native.syncRules?.() || "{}") })
  }, [])
  useFocusEffect(
    useCallback(() => {
      refresh()
      if (!native) return
      // Kotlin reuses the camera backup event to say a pair changed.
      const sub = native.addListener("backup", refresh)
      const app = AppState.addEventListener("change", (s) => s === "active" && refresh())
      return () => {
        sub.remove()
        app.remove()
      }
    }, [refresh])
  )
  return {
    pairs,
    failures,
    rules,
    refresh,
    add: (json: object) => native!.syncAdd!(JSON.stringify(json)),
    update: (p: SyncPair, change: Partial<Pick<SyncPair, "name" | "twoWay" | "paused">>) => {
      const next = { ...p, ...change }
      native!.syncUpdate!(p.id, next.name, next.twoWay, next.paused)
      setTimeout(refresh, 200)
    },
    remove: (id: string) => {
      native!.syncRemove!(id)
      refresh()
    },
    syncNow: (id: string | null) => {
      native!.syncNow!(id)
      setTimeout(refresh, 300)
    },
    retry: (id: string | null) => {
      native!.syncRetry!(id)
      setTimeout(refresh, 300)
    },
    setRules: (change: Partial<SyncRules>) => {
      const next = { ...rules, ...change }
      setRules(next)
      native!.setSyncRules!(JSON.stringify(next))
    },
  }
}
