import { clearCache } from "./file-cache"
import * as SecureStore from "expo-secure-store"
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"

import { json, send, trustServer, type Account, type Me } from "./api"
import { backupAvailable, readSettings, saveSettings } from "./backup"
import { native } from "./native"
import { forgetAccount } from "./offline"
import { forgetPush } from "./push"
import { engine } from "./uploads"

const KEY = "accounts.v1"
type Saved = { accounts: Account[]; activeId: string | null }

type Ctx = Saved & {
  ready: boolean
  active: Account | null
  add: (server: string, token: string) => Promise<Account>
  switchTo: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

const Accounts = createContext<Ctx | null>(null)

// Kotlin's uploader and backup call the server while the app is closed, so they keep their own copy.
const mirror = (s: Saved) => native?.setAccounts(JSON.stringify(s.accounts.map(({ id, server, token, email }) => ({ id, server, token, email }))))

export function AccountsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Saved>({ accounts: [], activeId: null })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((s) => {
        if (!s) return
        const saved: Saved = JSON.parse(s)
        saved.accounts.forEach((a) => trustServer(a.server))
        setState(saved)
        mirror(saved)
      })
      .finally(() => setReady(true))
  }, [])

  const save = useCallback(async (next: Saved) => {
    setState(next)
    mirror(next)
    await SecureStore.setItemAsync(KEY, JSON.stringify(next))
  }, [])

  const add = useCallback(
    async (server: string, token: string) => {
      const me = await json<Me>(server, "/api/v1/me", { token })
      const account: Account = {
        id: `${server}|${me.id}`,
        server,
        userId: me.id,
        name: me.name,
        email: me.email,
        image: me.image,
        token,
      }
      await save({
        accounts: [...state.accounts.filter((a) => a.id !== account.id), account],
        activeId: account.id,
      })
      return account
    },
    [state, save]
  )

  const switchTo = useCallback(
    (id: string) => save({ ...state, activeId: id }),
    [state, save]
  )

  // Ends the session on the server too; a failed call still forgets it here.
  const remove = useCallback(
    async (id: string) => {
      const gone = state.accounts.find((a) => a.id === id)
      if (gone) await forgetPush(gone)
      if (gone)
        await send(gone.server, "/api/auth/sign-out", {
          method: "POST",
          token: gone.token,
          body: "{}",
        }).catch(() => {})
      clearCache(id)
      forgetAccount(id)
      engine.cancelAccount(id)
      // Keys, fingerprint keys and queued vault uploads go with the account.
      if (typeof native?.vaultForget === "function") native.vaultForget(id, null)
      // Backup can't carry on into an account that's gone; More says so on the backup screen.
      if (backupAvailable && readSettings().accountId === id) saveSettings({ enabled: false, accountId: null })
      const accounts = state.accounts.filter((a) => a.id !== id)
      await save({
        accounts,
        activeId: state.activeId === id ? (accounts[0]?.id ?? null) : state.activeId,
      })
    },
    [state, save]
  )

  const value = useMemo(
    () => ({
      ...state,
      ready,
      active: state.accounts.find((a) => a.id === state.activeId) ?? null,
      add,
      switchTo,
      remove,
    }),
    [state, ready, add, switchTo, remove]
  )
  return <Accounts value={value}>{children}</Accounts>
}

export function useAccounts() {
  const ctx = use(Accounts)
  if (!ctx) throw new Error("useAccounts needs AccountsProvider")
  return ctx
}
