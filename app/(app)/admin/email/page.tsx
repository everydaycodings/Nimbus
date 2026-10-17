import {
  EnvelopeSimpleIcon,
  EnvelopeSimpleOpenIcon,
} from "@phosphor-icons/react/dist/ssr"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { canSend, getEmailConfig, type EmailConfig } from "@/lib/email"
import { requireAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { EmailForm, TestEmail } from "./email-form"

const TRANSPORT_LABEL = { none: "Off", smtp: "SMTP", resend: "Resend" }

function describe(c: EmailConfig) {
  if (c.transport === "smtp")
    return `SMTP through ${c.smtp.host || "a server that isn't set"}`
  if (c.transport === "resend") return "Resend"
  return null
}

function EnvSummary({ c }: { c: EmailConfig }) {
  const secret = (v: string) => (v ? "Set" : "Not set")
  const rows: [string, string][] = [
    ["EMAIL_TRANSPORT", TRANSPORT_LABEL[c.transport]],
    ...(c.transport !== "none"
      ? ([["EMAIL_FROM", c.from || "Not set"]] as [string, string][])
      : []),
    ...(c.transport === "smtp"
      ? ([
          ["SMTP_HOST", c.smtp.host || "Not set"],
          ["SMTP_PORT", String(c.smtp.port)],
          ["SMTP_SECURE", c.smtp.secure ? "true" : "false"],
          ["SMTP_USER", c.smtp.user || "Not set"],
          ["SMTP_PASSWORD", secret(c.smtp.password)],
        ] as [string, string][])
      : []),
    ...(c.transport === "resend"
      ? ([["RESEND_API_KEY", secret(c.resendApiKey)]] as [string, string][])
      : []),
  ]
  return (
    <div className="flex flex-col gap-3">
      <dl className="divide-y rounded-lg border text-sm">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="grid grid-cols-[minmax(0,12rem)_1fr] gap-4 px-4 py-2.5"
          >
            <dt className="truncate font-mono text-xs leading-5 text-muted-foreground">
              {k}
            </dt>
            <dd className="truncate">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        To change these, edit the server&apos;s environment and restart Nimbus.
        Unset <code className="font-mono text-xs">EMAIL_TRANSPORT</code> to
        manage email here instead.
      </p>
    </div>
  )
}

export default async function EmailPage() {
  const me = await requireAdmin()
  const c = await getEmailConfig()
  const working = canSend(c)
  const via = describe(c)
  const s = c.source === "db" ? await getSettings() : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
          {working ? (
            <EnvelopeSimpleOpenIcon className="size-4 text-brand" />
          ) : (
            <EnvelopeSimpleIcon className="size-4 text-muted-foreground" />
          )}
        </span>
        <div className="grid gap-0.5 text-sm">
          <p className="font-medium">
            {working
              ? `Email is on, sending with ${via}`
              : c.transport === "none"
                ? "Email is off"
                : `${via} isn't finished, so email is off`}
          </p>
          <p className="text-muted-foreground">
            {working
              ? "Password resets, email confirmation, join-request notices to admins and approval notices to members all go out."
              : "Without email, members who forget their password ask an admin, who sets a temporary one from Members. Two-factor still works."}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Delivery
            {c.source === "env" && (
              <Badge variant="outline">From environment</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {c.source === "env"
              ? "Email settings are set in env, so they're read-only here."
              : "Credentials are encrypted before they're saved, and never sent back to your browser."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {c.source === "env" || !s ? (
            <EnvSummary c={c} />
          ) : (
            <EmailForm
              values={{
                transport: s.emailTransport,
                from: s.emailFrom ?? "",
                host: s.smtpHost ?? "",
                port: s.smtpPort ?? 587,
                secure: s.smtpSecure,
                user: s.smtpUser ?? "",
                hasPassword: Boolean(s.smtpPassword),
                hasApiKey: Boolean(s.resendApiKey),
                sealedSecretLost: c.sealedSecretLost,
              }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test</CardTitle>
          <CardDescription>
            {working
              ? `Sends a short email to ${me.email} using the saved settings.`
              : "Save working settings first, then send yourself a test."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TestEmail to={me.email} disabled={!working} />
        </CardContent>
      </Card>
    </div>
  )
}
