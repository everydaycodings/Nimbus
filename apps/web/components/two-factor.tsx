"use client"

import { DownloadSimpleIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { renderSVG } from "uqr"

import { CopyButton } from "@/components/copy-button"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth-client"

type Step =
  | { name: "password" }
  | { name: "scan"; uri: string; backupCodes: string[] }
  | { name: "codes"; backupCodes: string[] }

const ERROR = "Something went wrong. Try again."

export function CodeInput(props: React.ComponentProps<typeof Input>) {
  return (
    <Input
      name="code"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      maxLength={6}
      required
      placeholder="000000"
      title="The 6-digit code from your authenticator app"
      className="max-w-40 font-mono text-base tracking-[0.3em] tabular-nums"
      {...props}
    />
  )
}

export function FormError({ children }: { children: React.ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  )
}

function PasswordStep({
  label,
  submitLabel,
  variant,
  onPassword,
}: {
  label: string
  submitLabel: string
  variant?: "default" | "destructive" | "outline"
  onPassword: (password: string) => Promise<string | null>
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(
          await onPassword(
            String(new FormData(e.currentTarget).get("password"))
          )
        )
        setBusy(false)
      }}
    >
      <div className="grid max-w-sm gap-2">
        <Label htmlFor="tf-password">{label}</Label>
        <Input
          id="tf-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
        />
      </div>
      <FormError>{error}</FormError>
      <SubmitButton pending={busy} variant={variant} className="self-start">
        {submitLabel}
      </SubmitButton>
    </form>
  )
}

export function BackupCodes({
  codes,
  onDone,
}: {
  codes: string[]
  onDone: () => void
}) {
  const text = codes.join("\n")
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium">Save your backup codes</p>
        <p className="text-sm text-muted-foreground">
          If you lose your phone, each code gets you in once. Keep them
          somewhere safe, like a password manager. You won&apos;t see them
          again.
        </p>
      </div>
      <ul className="grid w-fit grid-cols-2 gap-x-8 gap-y-1.5 rounded-lg border bg-input/20 px-5 py-4 font-mono text-sm tabular-nums">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={text} />
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <a
              href={`data:text/plain;charset=utf-8,${encodeURIComponent(text + "\n")}`}
              download="nimbus-backup-codes.txt"
            />
          }
        >
          <DownloadSimpleIcon />
          Download
        </Button>
      </div>
      <Button onClick={onDone} className="self-start">
        I&apos;ve saved them
      </Button>
    </div>
  )
}

// Turn on two-factor: confirm the password, scan the QR code, prove it works
// with one code, then keep the backup codes.
export function TwoFactorSetup({
  autoStart = false,
  startVariant = "default",
}: {
  autoStart?: boolean
  startVariant?: "default" | "outline"
}) {
  const router = useRouter()
  const [started, setStarted] = useState(autoStart)
  const [step, setStep] = useState<Step>({ name: "password" })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!started)
    return (
      <Button
        variant={startVariant}
        onClick={() => setStarted(true)}
        className="self-start"
      >
        Set up two-factor
      </Button>
    )

  if (step.name === "password")
    return (
      <PasswordStep
        label="Confirm your password to start"
        submitLabel="Continue"
        onPassword={async (password) => {
          const { data, error } = await authClient.twoFactor.enable({
            password,
          })
          if (error || data?.method !== "totp") return error?.message ?? ERROR
          setStep({
            name: "scan",
            uri: data.totpURI,
            backupCodes: data.backupCodes,
          })
          return null
        }}
      />
    )

  if (step.name === "codes")
    return (
      <BackupCodes codes={step.backupCodes} onDone={() => router.refresh()} />
    )

  const secret = new URL(step.uri).searchParams.get("secret") ?? ""
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div
          role="img"
          aria-label="QR code for your authenticator app"
          className="size-40 shrink-0 overflow-hidden rounded-lg bg-white p-2 [&>svg]:size-full"
          dangerouslySetInnerHTML={{
            __html: renderSVG(step.uri, { border: 0 }),
          }}
        />
        <div className="grid gap-3 text-sm">
          <p>
            Scan this with an authenticator app such as 1Password, Google
            Authenticator or Aegis.
          </p>
          <div className="grid gap-1.5">
            <p className="text-muted-foreground">
              Can&apos;t scan? Enter this key:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border bg-input/20 px-2 py-1 font-mono text-xs break-all">
                {secret.match(/.{1,4}/g)?.join(" ")}
              </code>
              <CopyButton value={secret} />
            </div>
          </div>
        </div>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault()
          setError(null)
          setBusy(true)
          const code = String(new FormData(e.currentTarget).get("code"))
          const { error } = await authClient.twoFactor.verifyTotp({ code })
          setBusy(false)
          if (error)
            return setError(
              "That code didn't match. Check the time on your phone and try the newest code."
            )
          setStep({ name: "codes", backupCodes: step.backupCodes })
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="tf-code">Enter the 6-digit code it shows</Label>
          <CodeInput id="tf-code" autoFocus />
        </div>
        <FormError>{error}</FormError>
        <SubmitButton pending={busy} className="self-start">
          Turn on two-factor
        </SubmitButton>
      </form>
    </div>
  )
}

// Two-factor is on: make fresh backup codes or turn it off. Both need the password.
export function TwoFactorManage({ locked }: { locked: boolean }) {
  const router = useRouter()
  const [mode, setMode] = useState<"idle" | "codes" | "disable">("idle")
  const [codes, setCodes] = useState<string[] | null>(null)

  if (codes)
    return (
      <BackupCodes
        codes={codes}
        onDone={() => (setCodes(null), setMode("idle"))}
      />
    )

  if (mode === "codes")
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          New codes replace the old ones, which stop working.
        </p>
        <PasswordStep
          label="Confirm your password"
          submitLabel="Make new codes"
          onPassword={async (password) => {
            const { data, error } =
              await authClient.twoFactor.generateBackupCodes({ password })
            if (error || !data) return error?.message ?? ERROR
            setCodes(data.backupCodes)
            return null
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setMode("idle")}
        >
          Cancel
        </Button>
      </div>
    )

  if (mode === "disable")
    return (
      <div className="flex flex-col gap-3">
        <PasswordStep
          label="Confirm your password to turn off two-factor"
          submitLabel="Turn off two-factor"
          variant="destructive"
          onPassword={async (password) => {
            const { error } = await authClient.twoFactor.disable({ password })
            if (error) return error.message ?? ERROR
            router.refresh()
            return null
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setMode("idle")}
        >
          Cancel
        </Button>
      </div>
    )

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => setMode("codes")}>
        New backup codes
      </Button>
      {locked ? (
        <p className="self-center text-sm text-muted-foreground">
          Your admin requires two-factor, so it can&apos;t be turned off.
        </p>
      ) : (
        <Button variant="destructive" onClick={() => setMode("disable")}>
          Turn off
        </Button>
      )}
    </div>
  )
}
