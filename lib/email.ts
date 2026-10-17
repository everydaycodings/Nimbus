// Relative imports: lib/auth.ts imports this and the Better Auth CLI can't resolve `@/`.
import nodemailer from "nodemailer"

import { decrypt } from "./crypto"
import { EMAIL_TRANSPORTS, type EmailTransport } from "./db/schema"
import { getSettings } from "./signup"

export type EmailConfig = {
  // "env" means EMAIL_TRANSPORT is set, so the admin panel shows it read-only.
  source: "env" | "db"
  transport: EmailTransport
  from: string
  smtp: {
    host: string
    port: number
    secure: boolean
    user: string
    password: string
  }
  resendApiKey: string
  // A stored secret couldn't be decrypted, usually because BETTER_AUTH_SECRET changed.
  sealedSecretLost: boolean
}

export async function getEmailConfig(): Promise<EmailConfig> {
  const env = process.env
  const fromEnv = env.EMAIL_TRANSPORT as EmailTransport | undefined
  if (fromEnv && EMAIL_TRANSPORTS.includes(fromEnv))
    return {
      source: "env",
      transport: fromEnv,
      from: env.EMAIL_FROM ?? "",
      smtp: {
        host: env.SMTP_HOST ?? "",
        port: Number(env.SMTP_PORT) || 587,
        secure: env.SMTP_SECURE === "true",
        user: env.SMTP_USER ?? "",
        password: env.SMTP_PASSWORD ?? "",
      },
      resendApiKey: env.RESEND_API_KEY ?? "",
      sealedSecretLost: false,
    }

  const s = await getSettings()
  const smtpPassword = s.smtpPassword ? decrypt(s.smtpPassword) : ""
  const resendApiKey = s.resendApiKey ? decrypt(s.resendApiKey) : ""
  return {
    source: "db",
    transport: s.emailTransport,
    from: s.emailFrom ?? "",
    smtp: {
      host: s.smtpHost ?? "",
      port: s.smtpPort ?? 587,
      secure: s.smtpSecure,
      user: s.smtpUser ?? "",
      password: smtpPassword ?? "",
    },
    resendApiKey: resendApiKey ?? "",
    sealedSecretLost: smtpPassword === null || resendApiKey === null,
  }
}

// Email-dependent features (reset, verification, notices) switch on only when this is true.
export function canSend(c: EmailConfig) {
  if (!c.from) return false
  if (c.transport === "smtp") return Boolean(c.smtp.host)
  if (c.transport === "resend") return Boolean(c.resendApiKey)
  return false
}

export async function emailEnabled() {
  return canSend(await getEmailConfig())
}

type Message = { to: string; subject: string; text: string; html: string }

export async function sendWith(c: EmailConfig, m: Message) {
  if (!canSend(c)) throw new Error("Email isn't set up.")
  if (c.transport === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: c.from, ...m }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        message?: string
      } | null
      throw new Error(body?.message ?? `Resend answered ${res.status}.`)
    }
    return
  }
  const { host, port, secure, user, password } = c.smtp
  // ponytail: a fresh connection per message; pool it if notices start going out in bulk
  await nodemailer
    .createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass: password } : undefined,
    })
    .sendMail({ from: c.from, ...m })
}

// Auth emails must never fail the request that triggered them, and awaiting the
// send would leak whether an address exists through response timing.
export function sendInBackground(m: Message) {
  void getEmailConfig()
    .then((c) => (canSend(c) ? sendWith(c, m) : undefined))
    .catch((e) => console.error(`[email] "${m.subject}" to ${m.to}:`, e))
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!
  )

// One plain layout for every email: a paragraph or two and at most one button.
export function message(opts: {
  to: string
  subject: string
  lines: string[]
  action?: { label: string; url: string }
  footer?: string
}): Message {
  const { to, subject, lines, action, footer } = opts
  const text = [
    ...lines,
    ...(action ? [`${action.label}: ${action.url}`] : []),
    ...(footer ? [footer] : []),
  ].join("\n\n")
  const p = (s: string, style = "") =>
    `<p style="margin:0 0 16px;${style}">${esc(s)}</p>`
  const html = `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f5f5f5;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#171717">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:32px">
<p style="margin:0 0 24px;font-weight:600">Nimbus</p>
${lines.map((l) => p(l)).join("\n")}
${action ? `<p style="margin:24px 0"><a href="${esc(action.url)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;font-weight:500;padding:10px 18px;border-radius:8px">${esc(action.label)}</a></p>${p(`Or open this link: ${action.url}`, "font-size:13px;color:#737373;word-break:break-all")}` : ""}
${footer ? p(footer, "margin:24px 0 0;font-size:13px;color:#737373") : ""}
</div></body></html>`
  return { to, subject, text, html }
}

export function appUrl(path = "") {
  return `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}${path}`
}
