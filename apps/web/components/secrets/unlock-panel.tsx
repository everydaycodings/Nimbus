"use client"

import { startAuthentication } from "@simplewebauthn/browser"
import {
  FingerprintIcon,
  KeyIcon,
  LockKeyIcon,
  PasswordIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { api, errorText } from "@/components/secrets/client"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type Method = "password" | "passkey" | "totp" | "pin"

const LABEL: Record<Method, { name: string; field: string; icon: typeof KeyIcon }> = {
  password: { name: "Password", field: "Your Nimbus password", icon: PasswordIcon },
  passkey: { name: "Passkey", field: "", icon: FingerprintIcon },
  totp: { name: "2FA code", field: "6-digit code from your authenticator", icon: ShieldCheckIcon },
  pin: { name: "PIN", field: "Your Secrets PIN", icon: KeyIcon },
}

// The lock screen. The server holds the unlock; this only asks for the proof.
export function UnlockPanel({ methods, minutes }: { methods: Method[]; minutes: number }) {
  const router = useRouter()
  const [method, setMethod] = useState<Method>(methods[0])
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      router.refresh()
    } catch (e) {
      // Cancelling the browser's passkey prompt isn't worth a message.
      if (!(e instanceof Error && e.name === "NotAllowedError")) setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const bootstrap = methods.length === 0

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-10 sm:py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-muted">
          <LockKeyIcon className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Secrets are locked</h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {bootstrap
            ? "Your account has no password, passkey or two-factor to check, so choose a PIN to unlock Secrets with."
            : `Confirm it's you. Secrets lock again after ${minutes} minutes of no activity.`}
        </p>
      </div>

      {methods.length > 1 && (
        <div role="tablist" aria-label="Unlock with" className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1">
          {methods.map((m) => {
            const Icon = LABEL[m].icon
            return (
              <button
                key={m}
                role="tab"
                aria-selected={m === method}
                type="button"
                onClick={() => {
                  setMethod(m)
                  setValue("")
                  setError(null)
                }}
                className={cn(
                  "flex h-8 items-center justify-center gap-1.5 rounded-md text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  m === method ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-4" />
                <span className="max-sm:sr-only">{LABEL[m].name}</span>
              </button>
            )
          })}
        </div>
      )}

      {method === "passkey" && !bootstrap ? (
        <Button
          size="lg"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const optionsJSON = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
                "/unlock/options",
                "POST"
              )
              const response = await startAuthentication({ optionsJSON })
              await api("/unlock", "POST", { method: "passkey", value: response })
            })
          }
        >
          <FingerprintIcon />
          Use your passkey
        </Button>
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            run(() =>
              bootstrap
                ? api("/settings", "PUT", { pin: value })
                : api("/unlock", "POST", { method, value })
            )
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="unlock-value">
              {bootstrap ? "Choose a PIN (6 to 32 characters)" : LABEL[method].field}
            </Label>
            <Input
              id="unlock-value"
              type={method === "totp" ? "text" : "password"}
              inputMode={method === "totp" ? "numeric" : undefined}
              autoComplete={method === "totp" ? "one-time-code" : bootstrap ? "new-password" : "current-password"}
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <SubmitButton pending={busy} disabled={!value.trim()}>
            {bootstrap ? "Set PIN and unlock" : "Unlock"}
          </SubmitButton>
        </form>
      )}
      <p role="alert" className="min-h-5 text-center text-sm text-destructive">
        {error}
      </p>
    </div>
  )
}
