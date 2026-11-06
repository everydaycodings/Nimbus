import { useEffect } from "react"
import { AppState } from "react-native"

import { useAccounts } from "@/lib/accounts"
import { native } from "@/lib/native"
import { pushAvailable, registerEndpoint, syncPush } from "@/lib/push"

// Keeps every account's push endpoint registered: at launch, on return to the app (the distributor may have
// just been installed) and whenever Android's distributor hands out a new endpoint. Draws nothing.
export function PushWatcher() {
  const { accounts, ready } = useAccounts()
  const key = accounts.map((a) => a.id).join()

  useEffect(() => {
    if (!pushAvailable || !ready || !accounts.length) return
    syncPush(accounts)
    const state = AppState.addEventListener("change", (s) => s === "active" && syncPush(accounts))
    const event = native?.addListener("push", (e) => {
      const account = accounts.find((a) => a.id === e.accountId)
      if (account && e.endpoint) registerEndpoint(account, e.endpoint).catch(() => {})
    })
    return () => {
      state.remove()
      event?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the account list
  }, [ready, key])
  return null
}
