// Which vaults are open, and when they lock: after the account's idle minutes, after 30 s in the background,
// on Lock, and on sign-out (accounts.tsx). The keys are in Kotlin; this only knows which ids are open.
import type { AccountResponse } from "@nimbus/shared/api"
import { useQueryClient } from "@tanstack/react-query"
import { Directory, Paths } from "expo-file-system"
import { useFocusEffect, useNavigation, useRoute } from "expo-router"
import { StackActions } from "expo-router/react-navigation"
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AppState, View } from "react-native"
import { isPicking } from "@/lib/picking"

import { useSnack } from "@/components/snackbar"
import { useAccounts } from "@/lib/accounts"
import { c } from "@/lib/theme"
import type { UploadRow } from "@/lib/upload-plan"
import { vaultNative } from "@/lib/vault"
import { awayExpired, idleExpired } from "@/lib/vault-rules"

type Ctx = {
  isOpen: (vaultId: string) => boolean
  markOpen: (vaultId: string) => void
  lock: (vaultId: string) => void
  lockAll: () => void
  touch: () => void
  // Keeps the screen out of screenshots until the returned function is called.
  hold: () => () => void
}
const VaultLock = createContext<Ctx | null>(null)
export const useVaultLock = () => use(VaultLock)!

const key = (account: string, vault: string) => `${account}\n${vault}`
const DEFAULT_MINUTES = 15

export { whilePicking } from "@/lib/picking"

export function VaultLockProvider({ children }: { children: ReactNode }) {
  const { active } = useAccounts()
  const client = useQueryClient()
  const snack = useSnack()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const last = useRef(Date.now())
  const holds = useRef(0)

  const accountId = active?.id ?? ""
  const isOpen = useCallback(
    (vaultId: string) => open.has(key(accountId, vaultId)) && !!vaultNative?.vaultIsOpen(accountId, vaultId),
    [open, accountId]
  )
  const touch = useCallback(() => void (last.current = Date.now()), [])
  const markOpen = useCallback(
    (vaultId: string) => {
      last.current = Date.now()
      setOpen((s) => new Set(s).add(key(accountId, vaultId)))
    },
    [accountId]
  )
  const lock = useCallback(
    (vaultId: string) => {
      vaultNative?.vaultLock(accountId, vaultId)
      setOpen((s) => {
        const next = new Set(s)
        next.delete(key(accountId, vaultId))
        return next
      })
    },
    [accountId]
  )
  // Everything locks together, as on the web. Vault screens and the previewer each leave when they see it.
  const lockAll = useCallback(() => {
    vaultNative?.vaultLockAll(null)
    setOpen(new Set())
  }, [])

  const hold = useCallback(() => {
    holds.current++
    vaultNative?.setSecure(true)
    return () => {
      if (--holds.current === 0) vaultNative?.setSecure(false)
    }
  }, [])

  // A fresh JS start knows of no open vaults, so Kotlin shouldn't either (a reload keeps its memory).
  useEffect(() => {
    vaultNative?.vaultLockAll(null)
    // Plaintext copies left by a Move to vault or Move out the app was killed during. Kept while uploads may still read them.
    const rows: UploadRow[] = JSON.parse(vaultNative?.uploads() ?? "[]")
    if (rows.some((r) => !["done", "failed", "refused"].includes(r.status)))
      return
    for (const name of ["vault-in", "vault-out"]) {
      const dir = new Directory(Paths.cache, name)
      if (dir.exists) dir.delete()
    }
  }, [])

  const anyOpen = open.size > 0
  const lockWithNotice = useCallback(() => {
    lockAll()
    snack({ text: "Vaults locked." })
  }, [lockAll, snack])

  useEffect(() => {
    if (!anyOpen) return
    const t = setInterval(() => {
      const minutes = client.getQueryData<AccountResponse>([accountId, "account"])?.vaultLockMinutes ?? DEFAULT_MINUTES
      if (!isPicking() && idleExpired(Date.now(), last.current, minutes)) lockWithNotice()
    }, 15_000)
    return () => clearInterval(t)
  }, [anyOpen, client, accountId, lockWithNotice])

  useEffect(() => {
    if (!anyOpen) return
    let since = 0
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") since = Date.now()
      else if (state === "active") {
        if (!isPicking() && awayExpired(Date.now(), since)) lockWithNotice()
        since = 0
      }
    })
    return () => sub.remove()
  }, [anyOpen, lockWithNotice])

  const value = useMemo(() => ({ isOpen, markOpen, lock, lockAll, touch, hold }), [isOpen, markOpen, lock, lockAll, touch, hold])
  return <VaultLock value={value}>{children}</VaultLock>
}

// Every vault screen sits in this: screenshots are blocked while it's focused, and a touch counts as use.
export function Secure() {
  const { hold } = useVaultLock()
  useFocusEffect(useCallback(() => hold(), [hold]))
  return null
}

export function VaultShell({ children }: { children: ReactNode }) {
  const { touch } = useVaultLock()
  return (
    <View style={{ flex: 1, backgroundColor: c.background }} onTouchStartCapture={touch}>
      <Secure />
      {children}
    </View>
  )
}

// A screen inside one vault goes to the unlock screen when the vault isn't open.
export function useNeedsUnlock(vaultId: string, name?: string) {
  const { isOpen } = useVaultLock()
  const open = isOpen(vaultId)
  const navigation = useNavigation()
  const route = useRoute()
  useFocusEffect(
    useCallback(() => {
      // This screen's own route, not whatever is on top: a share arriving as the vault locks may have just pushed Save to.
      if (!open) navigation.dispatch({ ...StackActions.replace("vault/[id]/unlock", { id: vaultId, name }), source: route.key })
    }, [open, vaultId, name, navigation, route.key])
  )
  return open
}
