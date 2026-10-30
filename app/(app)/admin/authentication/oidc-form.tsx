"use client"

import { CheckCircleIcon } from "@phosphor-icons/react"
import { startTransition, useActionState, useEffect, useRef } from "react"

import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { saveOidc, testOidc } from "./actions"

// Never carries the secret: only whether one is stored.
export type OidcFormValues = {
  name: string
  issuer: string
  clientId: string
  hasSecret: boolean
  sealedSecretLost: boolean
  only: boolean
  ready: boolean
}

function Done({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-center gap-1.5 text-sm text-muted-foreground"
    >
      <CheckCircleIcon weight="fill" className="size-4 text-brand" />
      {children}
    </p>
  )
}

// Fetches the issuer's discovery document: the one typed in the form, or the
// env one when there's no form.
export function TestOidc() {
  const [state, action, pending] = useActionState(testOidc, null)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          type="button"
          variant="outline"
          pending={pending}
          onClick={(e) => {
            const form = e.currentTarget.form
            startTransition(() =>
              action(form ? new FormData(form) : new FormData())
            )
          }}
        >
          Test
        </SubmitButton>
        {state?.issuer && <Done>Found {state.issuer}</Done>}
      </div>
      <FormError>{state?.error}</FormError>
    </div>
  )
}

export function OidcForm({ values }: { values: OidcFormValues }) {
  const [state, action, pending] = useActionState(saveOidc, null)
  const lost = values.sealedSecretLost
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const el = ref.current?.elements.namedItem("clientSecret")
    if (state?.ok && el instanceof HTMLInputElement) el.value = ""
  }, [state])

  return (
    <form
      ref={ref}
      // onSubmit rather than action={}, so a failed save keeps what was typed.
      onSubmit={(e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        startTransition(() => action(data))
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <Label htmlFor="oidc-name">Button name</Label>
          <Input
            id="oidc-name"
            name="name"
            defaultValue={values.name}
            placeholder="SSO"
            maxLength={40}
            aria-describedby="oidc-name-hint"
          />
          <p id="oidc-name-hint" className="text-xs text-muted-foreground">
            Shown as “Sign in with …”, e.g. Authentik.
          </p>
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="oidc-issuer">Issuer URL</Label>
          <Input
            id="oidc-issuer"
            name="issuer"
            type="url"
            defaultValue={values.issuer}
            placeholder="https://auth.example.com/application/o/nimbus/"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="oidc-issuer-hint"
          />
          <p id="oidc-issuer-hint" className="text-xs text-muted-foreground">
            Leave blank to turn OIDC off.
          </p>
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="oidc-client">Client ID</Label>
          <Input
            id="oidc-client"
            name="clientId"
            defaultValue={values.clientId}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="oidc-secret">Client secret</Label>
          <Input
            id="oidc-secret"
            name="clientSecret"
            type="password"
            autoComplete="new-password"
            placeholder={values.hasSecret && !lost ? "••••••••••••" : ""}
            aria-describedby="oidc-secret-hint"
            aria-invalid={lost || undefined}
          />
          <p
            id="oidc-secret-hint"
            className={`text-xs ${lost ? "text-destructive" : "text-muted-foreground"}`}
          >
            {lost
              ? "The saved secret can't be read, probably because BETTER_AUTH_SECRET changed. Enter it again."
              : values.hasSecret
                ? "Saved and encrypted. Leave blank to keep it."
                : "Stored encrypted in your database."}
          </p>
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="only"
          defaultChecked={values.only}
          disabled={!values.ready}
          className="mt-0.5 size-4 shrink-0 accent-primary"
        />
        <span className="grid gap-0.5">
          <span>OIDC only</span>
          <span className="text-muted-foreground">
            {values.ready
              ? "Hides password, Google and GitHub sign-in. The owner keeps their password through “Owner sign-in”."
              : "Save a working provider first."}
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-start gap-3 border-t pt-4">
        <SubmitButton pending={pending}>Save</SubmitButton>
        <TestOidc />
        {state?.ok && <Done>Saved.</Done>}
        <FormError>{state?.error}</FormError>
      </div>
    </form>
  )
}
