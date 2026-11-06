// Crashes stay on this phone: a marker for the next launch to offer in a report. Nothing is ever sent.
import Storage from "expo-sqlite/kv-store"

import { logError } from "./error-log"
import { native } from "./native"

const KEY = "lastCrash"
export type Crash = { source: "js" | "native"; text: string }

// A React error or a fatal JS exception. Never throws.
export function recordCrash(e: unknown) {
  logError("crash", e)
  try {
    const text = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)
    Storage.setItemSync(KEY, JSON.stringify({ at: new Date().toISOString(), text: text.slice(0, 4000) }))
  } catch {}
}

// The native file has the whole stack and wins; the JS marker covers an error React caught without dying.
export function pendingCrash(): Crash | null {
  try {
    const n = native?.lastCrash?.()
    if (n) return { source: "native", text: n }
    const js = Storage.getItemSync(KEY)
    if (js) {
      const m = JSON.parse(js) as { at: string; text: string }
      return { source: "js", text: `time: ${m.at}\n${m.text}` }
    }
  } catch {}
  return null
}

export function clearCrash() {
  try {
    native?.clearCrash?.()
    Storage.removeItemSync(KEY)
  } catch {}
}
