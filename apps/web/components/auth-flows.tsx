"use client"

import { FingerprintIcon } from "@phosphor-icons/react"
import { startAuthentication } from "@simplewebauthn/browser"
import Link from "next/link"
import { useState } from "react"

import { NewPasswordFields } from "@/components/password-input"
import { SubmitButton } from "@/components/submit-button"
import { CodeInput, FormError } from "@/components/two-factor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { reloadTo } from "@/lib/accounts"
import { authClient } from "@/lib/auth-client"

const ERROR = "Something went wrong. Try again."

export function BackToSignIn({
  label = "Back to sign in",
}: {
  label?: string
}) {
  return (
    <p className="text-center text-sm text-muted-foreground">
      <Link
        href="/sign-in"
        className="text-foreground underline underline-offset-4"
      >
        {label}
      </Link>
    </p>
  )
}

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (sentTo)
    return (
      <div className="flex flex-col gap-6">
        <p role="status" className="text-sm text-muted-foreground">
          If <span className="text-foreground">{sentTo}</span> has an account
          here, a reset link is on its way. It works for one hour. Check your
          spam folder if it doesn&apos;t show up.
        </p>
        <BackToSignIn />
      </div>
    )

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setError(null)
        setBusy(true)
        const email = String(new FormData(e.currentTarget).get("email"))
        const { error } = await authClient.requestPasswordReset({
          email,
          redirectTo: "/reset-password",
        })
        setBusy(false)
        if (error) return setError(error.message ?? ERROR)
        setSentTo(email)
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
        />
      </div>
      <FormError>{error}</FormError>
      <SubmitButton className="w-full" pending={busy}>
        Send reset link
      </SubmitButton>
      <BackToSignIn />
    </form>
  )
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (done)
    return (
      <div className="flex flex-col gap-6">
        <p role="status" className="text-sm text-muted-foreground">
          Your password is changed, and every device that was signed in has been
          signed out.
        </p>
        <Button
          nativeButton={false}
          render={<Link href="/sign-in" />}
          className="w-full"
        >
          Sign in
        </Button>
      </div>
    )

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setError(null)
        const form = new FormData(e.currentTarget)
        const newPassword = String(form.get("password"))
        if (newPassword !== String(form.get("confirm")))
          return setError("The passwords don't match.")
        setBusy(true)
        const { error } = await authClient.resetPassword({ newPassword, token })
        setBusy(false)
        if (error)
          return setError(
            error.code === "INVALID_TOKEN"
              ? "This reset link has expired or was already used. Ask for a new one."
              : (error.message ?? ERROR)
          )
        setDone(true)
      }}
    >
      <NewPasswordFields autoFocus />
      <FormError>{error}</FormError>
      <SubmitButton className="w-full" pending={busy}>
        Save new password
      </SubmitButton>
    </form>
  )
}

// The second sign-in step for accounts with two-factor on.
export function TwoFactorChallenge({
  next = "/",
  passkeys = false,
}: {
  next?: string
  passkeys?: boolean
}) {
  const [backup, setBackup] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A passkey instead of a code: the same step, answered on this device.
  async function withPasskey(trustDevice: boolean) {
    setError(null)
    setBusy(true)
    const post = (path: string, body?: object) =>
      fetch(`/api/auth/two-factor/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      })
    try {
      const options = await post("passkey-options")
      if (!options.ok) {
        const e = await options.json().catch(() => null)
        throw new Error(
          e?.code === "INVALID_TWO_FACTOR_COOKIE"
            ? "This sign-in timed out. Go back and sign in again."
            : e?.code === "NO_PASSKEY"
              ? "This account has no passkey yet. Use a code."
              : ERROR
        )
      }
      const response = await startAuthentication({
        optionsJSON: await options.json(),
      })
      const done = await post("verify-passkey", { response, trustDevice })
      if (!done.ok) throw new Error("That passkey didn't work. Try again.")
      reloadTo(next)
    } catch (e) {
      setBusy(false)
      // Closing the browser's prompt isn't an error.
      if (e instanceof Error && !/not allowed|abort|cancel/i.test(`${e.name} ${e.message}`))
        setError(e.message)
    }
  }

  return (
    <form
      key={backup ? "backup" : "totp"}
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setError(null)
        setBusy(true)
        const form = new FormData(e.currentTarget)
        const code = String(form.get("code")).trim()
        const trustDevice = form.get("trust") === "on"
        const { error } = backup
          ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
          : await authClient.twoFactor.verifyTotp({ code, trustDevice })
        if (error) {
          setBusy(false)
          // The pending sign-in lives in a 10-minute cookie.
          if (error.code === "INVALID_TWO_FACTOR_COOKIE")
            return setError(
              "This sign-in timed out. Go back and sign in again."
            )
          return setError(
            error.code === "ACCOUNT_TEMPORARILY_LOCKED" || error.status === 429
              ? "Too many wrong codes. Wait 15 minutes, then sign in again."
              : backup
                ? "That backup code didn't work. Each code works only once."
                : "That code didn't match. Try the newest code from your app."
          )
        }
        reloadTo(next)
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">
          {backup ? "Backup code" : "Code from your authenticator app"}
        </Label>
        {backup ? (
          <Input
            id="code"
            name="code"
            autoComplete="off"
            spellCheck={false}
            required
            autoFocus
            className="font-mono"
          />
        ) : (
          <CodeInput
            id="code"
            autoFocus
            className="max-w-none font-mono text-base tracking-[0.3em] tabular-nums"
          />
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" name="trust" className="size-4 accent-primary" />
        Don&apos;t ask again on this device for 30 days
      </label>
      <FormError>{error}</FormError>
      <SubmitButton className="w-full" pending={busy}>
        Verify
      </SubmitButton>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={() => (setBackup(!backup), setError(null))}
      >
        {backup
          ? "Use your authenticator app"
          : "Lost your phone? Use a backup code"}
      </Button>
      {passkeys && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={(e) =>
            withPasskey(
              new FormData(e.currentTarget.form!).get("trust") === "on"
            )
          }
        >
          <FingerprintIcon weight="bold" />
          Use a passkey
        </Button>
      )}
      <BackToSignIn label="Sign in as someone else" />
    </form>
  )
}
