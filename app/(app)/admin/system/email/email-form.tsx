"use client"

import { CheckCircleIcon } from "@phosphor-icons/react"
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react"

import { SubmitButton } from "@/components/submit-button"
import { FormError } from "@/components/two-factor"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { EmailTransport } from "@/lib/db/schema"
import { saveEmail, sendTestEmail } from "./actions"

// Never carries a secret: only whether one is stored.
export type EmailFormValues = {
  transport: EmailTransport
  from: string
  host: string
  port: number
  secure: boolean
  user: string
  hasPassword: boolean
  hasApiKey: boolean
  sealedSecretLost: boolean
}

const TRANSPORTS: { value: EmailTransport; label: string; hint: string }[] = [
  {
    value: "none",
    label: "Off",
    hint: "No email. Admins reset passwords by hand.",
  },
  {
    value: "smtp",
    label: "SMTP",
    hint: "Any mail server: your host, Gmail, Postmark, SES.",
  },
  {
    value: "resend",
    label: "Resend",
    hint: "Send through the Resend API with a key.",
  },
]

function Saved({
  show,
  children,
}: {
  show?: boolean
  children: React.ReactNode
}) {
  if (!show) return null
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

const KEEP = "Saved and encrypted. Leave blank to keep it."

export function EmailForm({ values }: { values: EmailFormValues }) {
  const [transport, setTransport] = useState(values.transport)
  const [state, action, pending] = useActionState(saveEmail, null)
  const lost = values.sealedSecretLost
  const formRef = useRef<HTMLFormElement>(null)
  // After a save, drop typed secrets. Not form.reset(): that would also put the
  // radios back to the transport the page first loaded with.
  useEffect(() => {
    if (!state?.ok) return
    for (const name of ["password", "apiKey"]) {
      const el = formRef.current?.elements.namedItem(name)
      if (el instanceof HTMLInputElement) el.value = ""
    }
  }, [state])

  return (
    <form
      ref={formRef}
      // onSubmit rather than action={}, so a failed save keeps what was typed.
      onSubmit={(e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        startTransition(() => action(data))
      }}
      className="flex flex-col gap-6"
    >
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-medium">Send email with</legend>
        {TRANSPORTS.map(({ value, label, hint }) => (
          <label
            key={value}
            className="flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors hover:bg-input/20 has-checked:border-ring/60 has-checked:bg-input/30 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
          >
            <input
              type="radio"
              name="transport"
              value={value}
              checked={transport === value}
              onChange={() => setTransport(value)}
              className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
            />
            <span className="grid gap-1">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-sm text-muted-foreground">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {transport !== "none" && (
        <div className="grid gap-2">
          <Label htmlFor="from">Sender</Label>
          <Input
            id="from"
            name="from"
            defaultValue={values.from}
            placeholder="Nimbus <nimbus@example.com>"
            aria-describedby="from-hint"
            required
          />
          <p id="from-hint" className="text-xs text-muted-foreground">
            The address people see emails come from. Your provider must allow
            sending from it.
          </p>
        </div>
      )}

      {transport === "smtp" && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="grid gap-2">
              <Label htmlFor="host">Server</Label>
              <Input
                id="host"
                name="host"
                defaultValue={values.host}
                placeholder="smtp.example.com"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                name="port"
                type="number"
                min={1}
                max={65535}
                defaultValue={values.port}
                required
                className="tabular-nums"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label htmlFor="user">Username</Label>
              <Input
                id="user"
                name="user"
                defaultValue={values.user}
                placeholder="Optional"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder={values.hasPassword && !lost ? "••••••••••••" : ""}
                aria-describedby="password-hint"
                aria-invalid={lost || undefined}
              />
              <p
                id="password-hint"
                className={`text-xs ${lost ? "text-destructive" : "text-muted-foreground"}`}
              >
                {lost
                  ? "The saved password can't be read, probably because BETTER_AUTH_SECRET changed. Enter it again."
                  : values.hasPassword
                    ? KEEP
                    : "Stored encrypted in your database."}
              </p>
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="secure"
              defaultChecked={values.secure}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="grid gap-0.5">
              <span>Use TLS from the start</span>
              <span className="text-muted-foreground">
                Usually port 465. When off, Nimbus upgrades with STARTTLS if the
                server offers it, usually on port 587.
              </span>
            </span>
          </label>
        </div>
      )}

      {transport === "resend" && (
        <div className="grid gap-2">
          <Label htmlFor="apiKey">API key</Label>
          <Input
            id="apiKey"
            name="apiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={values.hasApiKey && !lost ? "re_••••••••••••" : "re_…"}
            aria-describedby="apiKey-hint"
            aria-invalid={lost || undefined}
            className="font-mono"
          />
          <p
            id="apiKey-hint"
            className={`text-xs ${lost ? "text-destructive" : "text-muted-foreground"}`}
          >
            {lost
              ? "The saved key can't be read, probably because BETTER_AUTH_SECRET changed. Enter it again."
              : values.hasApiKey
                ? KEEP
                : "Create one with sending access at resend.com/api-keys. Stored encrypted in your database."}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <SubmitButton pending={pending}>Save</SubmitButton>
        <Saved show={state?.ok}>Saved.</Saved>
        <FormError>{state?.error}</FormError>
      </div>
    </form>
  )
}

export function TestEmail({ to, disabled }: { to: string; disabled: boolean }) {
  const [state, action] = useActionState(sendTestEmail, null)
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="outline" disabled={disabled}>
          Send a test email
        </SubmitButton>
        <Saved show={state?.ok}>
          Sent to {to}. If it doesn&apos;t arrive, check spam.
        </Saved>
      </div>
      <FormError>{state?.error}</FormError>
    </form>
  )
}
