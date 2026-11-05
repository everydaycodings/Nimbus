// Files another app shared into Nimbus, waiting for Save to. Only the installed app gets them.
import { router } from "expo-router"
import { useEffect } from "react"

import { native as module, type SharedFile } from "./native"

const native = typeof module?.sharedFiles === "function" ? module : null

let waiting: SharedFile[] = []
export const sharedFiles = () => waiting

async function take() {
  const files: SharedFile[] = JSON.parse((await native?.sharedFiles()) || "[]")
  if (!files.length) return
  waiting = files
  router.push("/save-to")
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
