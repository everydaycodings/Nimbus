// Files waiting for Save to: shared in from another app (installed app only), or picked from a
// home screen shortcut or widget (src/app/quick.tsx).
import { router } from "expo-router"
import { useEffect } from "react"

import { native as module, type SharedFile } from "./native"

const native = typeof module?.sharedFiles === "function" ? module : null

// A direct share folder (Android's share sheet) the files were sent to.
export type ShareTarget = { accountId: string; folderId: string | null; name: string }

let waiting: SharedFile[] = []
let exitAfter = true
let target: ShareTarget | null = null
export const sharedFiles = () => waiting
// An edited picture takes the place of the one that was shared.
export const replaceShared = (uri: string, edited: { uri: string; size: number; mime: string }) => {
  waiting = waiting.map((f) => (f.uri === uri ? { ...f, ...edited } : f))
}
// True when Save should hand back to the app that shared; false to return to Nimbus.
export const exitAfterSave = () => exitAfter
export const shareTarget = () => target

export function offerFiles(files: SharedFile[], exit: boolean, to: ShareTarget | null = null) {
  waiting = files
  exitAfter = exit
  target = to
  router.push("/save-to")
}

async function take() {
  const files: SharedFile[] = JSON.parse((await native?.sharedFiles()) || "[]")
  if (!files.length) return
  // Optional: older APKs don't have it.
  const to = typeof native?.sharedTarget === "function" ? native.sharedTarget() : null
  offerFiles(files, true, to ? JSON.parse(to) : null)
}

// At launch, and whenever a share arrives while the app is already open.
export function useShareIntake() {
  useEffect(() => {
    if (!native) return
    take()
    const sub = native.addListener("share", () => take())
    return () => sub.remove()
  }, [])
}
