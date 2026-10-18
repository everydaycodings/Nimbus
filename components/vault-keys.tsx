"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"

type Ctx = {
  keys: ReadonlyMap<string, CryptoKey>
  unlock: (vaultId: string, key: CryptoKey) => void
  lock: (vaultId: string) => void
}

const KeysContext = createContext<Ctx>({
  keys: new Map(),
  unlock() {},
  lock() {},
})
export const useVaultKeys = () => useContext(KeysContext)

// Unlocked vault keys, in memory only: a reload, signing out or `minutes`
// without a click or key press locks every vault.
export function VaultKeysProvider({
  minutes,
  children,
}: {
  minutes: number
  children: React.ReactNode
}) {
  const [keys, setKeys] = useState<ReadonlyMap<string, CryptoKey>>(new Map())
  const last = useRef(0)

  useEffect(() => {
    if (!keys.size) return
    last.current = Date.now()
    const seen = () => (last.current = Date.now())
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const
    for (const e of events) window.addEventListener(e, seen, { passive: true })
    // Timers stall in background tabs, so this also runs on return.
    const check = () => {
      if (Date.now() - last.current > minutes * 60_000) setKeys(new Map())
    }
    const t = setInterval(check, 15_000)
    document.addEventListener("visibilitychange", check)
    return () => {
      for (const e of events) window.removeEventListener(e, seen)
      clearInterval(t)
      document.removeEventListener("visibilitychange", check)
    }
  }, [keys.size, minutes])

  const ctx: Ctx = {
    keys,
    unlock: (id, key) => setKeys((k) => new Map(k).set(id, key)),
    lock: (id) =>
      setKeys((k) => {
        const next = new Map(k)
        next.delete(id)
        return next
      }),
  }
  return <KeysContext.Provider value={ctx}>{children}</KeysContext.Provider>
}
