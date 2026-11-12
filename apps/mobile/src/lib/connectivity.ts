// Whether the server can be reached. api.ts reports every request's outcome here; the offline watcher
// also clears it when the phone's own network comes back. Also whether the phone is on mobile data.
import * as Network from "expo-network"
import { useSyncExternalStore } from "react"

let unreachable = false
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function setUnreachable(value: boolean) {
  if (unreachable === value) return
  unreachable = value
  listeners.forEach((fn) => fn())
}

export const isOnline = () => !unreachable
export const useOnline = () => !useSyncExternalStore(subscribe, () => unreachable)

// Players ask once as they open; a failed check counts as Wi-Fi.
export const onMobileData = () =>
  Network.getNetworkStateAsync().then(
    (n) => n.type === Network.NetworkStateType.CELLULAR,
    () => false
  )
