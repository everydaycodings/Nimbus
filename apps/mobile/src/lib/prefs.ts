import Storage from "expo-sqlite/kv-store"
import { useCallback, useSyncExternalStore } from "react"

import type { Layout, Tiles } from "./rows"

export type Prefs = {
  layout: Layout
  sort: "name" | "date" | "size"
  order: "asc" | "desc"
  tiles: Tiles
  compact: boolean
  // Where downloads go: a folder the person picked in Android's picker.
  downloadDir?: string
  // Newest first, on this phone only.
  recentSearches?: string[]
  // Where Share into Nimbus last saved; null id is My files.
  saveTo?: { id: string | null; name: string }
  // Seconds each photo shows in a slideshow.
  slideshowSeconds?: 3 | 5 | 10
  // Photos tab: tiles per row.
  photoColumns?: number
}

const DEFAULTS: Prefs = { layout: "grid", sort: "name", order: "asc", tiles: "medium", compact: false }

// One set per account, shared by every screen that's mounted.
const cache = new Map<string, Prefs>()
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

function read(account: string) {
  let prefs = cache.get(account)
  if (!prefs) {
    let saved: Partial<Prefs> = {}
    try {
      saved = JSON.parse(Storage.getItemSync(`prefs.${account}`) ?? "{}")
    } catch {}
    prefs = { ...DEFAULTS, ...saved }
    cache.set(account, prefs)
  }
  return prefs
}

export function usePrefs(account: string) {
  const prefs = useSyncExternalStore(subscribe, () => read(account))
  const set = useCallback(
    (change: Partial<Prefs>) => {
      const next = { ...read(account), ...change }
      cache.set(account, next)
      listeners.forEach((fn) => fn())
      Storage.setItem(`prefs.${account}`, JSON.stringify(next)).catch(() => {})
    },
    [account]
  )
  return [prefs, set] as const
}
