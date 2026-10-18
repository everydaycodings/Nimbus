"use client"

import { GithubLogoIcon, GoogleLogoIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import {
  PasswordInput,
  StrengthMeter,
  usePasswordPolicy,
} from "@/components/password-input"
import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth-client"
import { minLength } from "@/lib/password-policy"

type Props = {
  mode: "sign-in" | "sign-up"
  providers: { google: boolean; github: boolean }
  // Set when an OAuth sign-in bounced back with ?error, e.g. sign-ups are closed.
  initialError?: string
  allowSignUp?: boolean
}

const OAUTH_ERROR =
  "That didn't work. If you're new here, sign-ups may be closed or need an invite link."

export function AuthForm({
  mode,
  providers,
  initialError,
  allowSignUp = true,
}: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(
    initialError ? OAUTH_ERROR : null
  )
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState("")
  const signUp = mode === "sign-up"
  const min = minLength(usePasswordPolicy())
  const hasSocial = providers.google || providers.github

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const form = new FormData(e.currentTarget)
    const email = String(form.get("email"))
    const password = String(form.get("password"))
    const { data, error } = signUp
      ? await authClient.signUp.email({
          name: String(form.get("name")),
          email,
          password,
        })
      : await authClient.signIn.email({ email, password })
    if (error) {
      setBusy(false)
      return setError(error.message ?? "Something went wrong. Try again.")
    }
    // Two-factor accounts get a session only after the second step.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect)
      return router.push("/two-factor")
    router.push("/")
    router.refresh()
  }

  async function social(provider: "google" | "github") {
    setError(null)
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: "/",
      errorCallbackURL: `/${mode}`,
    })
    if (error) setError(error.message ?? "Couldn't reach the provider.")
  }

  return (
    <div className="flex flex-col gap-6">
      {hasSocial && (
        <div className="flex flex-col gap-2">
          {providers.google && (
            <Button
              variant="outline"
              type="button"
              onClick={() => social("google")}
            >
              <GoogleLogoIcon weight="bold" />
              Continue with Google
            </Button>
          )}
          {providers.github && (
            <Button
              variant="outline"
              type="button"
              onClick={() => social("github")}
            >
              <GithubLogoIcon weight="fill" />
              Continue with GitHub
            </Button>
          )}
        </div>
      )}

      {hasSocial && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          Or continue with email
          <span className="h-px flex-1 bg-border" />
        </div>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {signUp && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" required />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="password">Password</Label>
            {!signUp && (
              <Link
                href="/forgot-password"
                className="text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
              >
                Forgot password?
              </Link>
            )}
          </div>
          <PasswordInput
            id="password"
            name="password"
            autoComplete={signUp ? "new-password" : "current-password"}
            minLength={signUp ? min : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={signUp ? "password-hint" : undefined}
            required
          />
          {signUp && <StrengthMeter id="password-hint" password={password} />}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <SubmitButton className="w-full" pending={busy}>
          {signUp ? "Create account" : "Sign in"}
        </SubmitButton>
      </form>

      {allowSignUp && (
        <p className="text-center text-sm text-muted-foreground">
          {signUp ? "Already have an account? " : "New here? "}
          <Link
            href={signUp ? "/sign-in" : "/sign-up"}
            className="text-foreground underline underline-offset-4"
          >
            {signUp ? "Sign in" : "Create an account"}
          </Link>
        </p>
      )}
    </div>
  )
}
