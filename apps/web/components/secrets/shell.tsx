"use client"

import { Dialog } from "@base-ui/react/dialog"
import { LockSimpleIcon, ShieldWarningIcon, SlidersHorizontalIcon, TerminalWindowIcon, XIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { api, errorText } from "@/components/secrets/client"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Status = { lockMinutes: number; lockChoices: number[]; hasPin: boolean; methods: string[] }

// Around every Secrets page once unlocked: locks after `minutes` of no clicks or
// keys (the server enforces the same clock), and holds Lock now and the settings.
export function SecretsShell({
  minutes,
  children,
}: {
  minutes: number
  children: React.ReactNode
}) {
  const router = useRouter()
  const last = useRef(0)
  const pinged = useRef(0)
  const [settings, setSettings] = useState(false)
  const [mins, setMins] = useState(minutes)

  useEffect(() => {
    last.current = pinged.current = Date.now()
    const seen = () => (last.current = Date.now())
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const
    for (const e of events) window.addEventListener(e, seen, { passive: true })
    const lock = () => {
      api("/lock", "POST").finally(() => router.refresh())
    }
    // Timers stall in background tabs, so this also runs on return.
    const check = () => {
      const now = Date.now()
      if (now - last.current > mins * 60_000) return lock()
      // Keep the server's clock in step with real activity.
      if (last.current > pinged.current && now - pinged.current > 60_000) {
        pinged.current = now
        api<Status>("/status?touch=1").catch(() => {})
      }
    }
    const t = setInterval(check, 15_000)
    document.addEventListener("visibilitychange", check)
    const locked = () => router.refresh()
    window.addEventListener("secrets-locked", locked)
    return () => {
      for (const e of events) window.removeEventListener(e, seen)
      clearInterval(t)
      document.removeEventListener("visibilitychange", check)
      window.removeEventListener("secrets-locked", locked)
    }
  }, [mins, router])

  return (
    <div className="flex flex-col gap-4">
      <div className="-mb-2 flex items-center justify-end gap-1 text-xs text-muted-foreground">
        <span className="mr-1 flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-brand" aria-hidden />
          Unlocked, locks after {mins} min idle
        </span>
        <Button variant="ghost" size="xs" render={<Link href="/secrets/leaks" />}>
          <ShieldWarningIcon />
          Leaks
        </Button>
        <Button variant="ghost" size="xs" render={<Link href="/secrets/cli" />}>
          <TerminalWindowIcon />
          CLI
        </Button>
        <Button variant="ghost" size="xs" onClick={() => setSettings(true)}>
          <SlidersHorizontalIcon />
          Lock settings
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={async () => {
            await api("/lock", "POST").catch(() => {})
            router.refresh()
          }}
        >
          <LockSimpleIcon />
          Lock now
        </Button>
      </div>
      {children}
      {settings && (
        <LockSettings
          onClose={() => setSettings(false)}
          onMinutes={(m) => setMins(m)}
        />
      )}
    </div>
  )
}

function LockSettings({
  onClose,
  onMinutes,
}: {
  onClose: () => void
  onMinutes: (m: number) => void
}) {
  const [st, setSt] = useState<Status | null>(null)
  const [pin, setPin] = useState("")
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null)

  useEffect(() => {
    api<Status>("/status").then(setSt).catch(() => {})
  }, [])

  async function save(body: object, done: string) {
    try {
      await api("/settings", "PUT", body)
      setNote({ text: done })
      setSt(await api<Status>("/status"))
      setPin("")
    } catch (e) {
      setNote({ text: errorText(e), error: true })
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={DIALOG_POPUP}>
          <div className="flex items-start gap-3">
            <div className="grid flex-1 gap-1">
              <Dialog.Title className="text-base font-semibold">Lock settings</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                Secrets lock on their own after you stop using them.
              </Dialog.Description>
            </div>
            <Dialog.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
              <XIcon />
            </Dialog.Close>
          </div>
          {st && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="auto-lock">Auto-lock after</Label>
                <select
                  id="auto-lock"
                  value={st.lockMinutes}
                  onChange={(e) => {
                    const m = Number(e.target.value)
                    onMinutes(m)
                    save({ lockMinutes: m }, "Saved.")
                  }}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30"
                >
                  {st.lockChoices.map((m) => (
                    <option key={m} value={m}>
                      {m} minutes of no activity
                    </option>
                  ))}
                </select>
              </div>
              <form
                className="grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  save({ pin }, st.hasPin ? "PIN changed." : "PIN set.")
                }}
              >
                <Label htmlFor="secrets-pin">
                  {st.hasPin ? "Change your Secrets PIN" : "Add a Secrets PIN"}
                </Label>
                <p className="text-xs text-muted-foreground">
                  A shortcut to unlock without your password. 6 to 32 characters.
                </p>
                <div className="flex gap-2">
                  <Input
                    id="secrets-pin"
                    type="password"
                    autoComplete="new-password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    maxLength={32}
                  />
                  <Button type="submit" disabled={pin.length < 6}>
                    {st.hasPin ? "Change" : "Set PIN"}
                  </Button>
                </div>
                {st.hasPin && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-fit text-destructive"
                    onClick={() => save({ pin: null }, "PIN removed.")}
                  >
                    Remove PIN
                  </Button>
                )}
              </form>
            </>
          )}
          <p
            role="status"
            className={note?.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
          >
            {note?.text}
          </p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
