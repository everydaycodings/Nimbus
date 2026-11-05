// Relative imports: lib/auth.ts imports this and the Better Auth CLI can't resolve `@/`.
import { readFileSync } from "node:fs"
import { join } from "node:path"
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

export type Message = {
  to: string
  subject: string
  text: string
  html: string
}

// The app icon rides along as an inline attachment, so it shows even when this
// server isn't reachable from the reader's mail client.
const LOGO_CID = "nimbus-logo"
let logo: Buffer | undefined
const getLogo = () =>
  (logo ??= readFileSync(join(process.cwd(), "app/apple-icon.png")))

export async function sendWith(c: EmailConfig, m: Message) {
  if (!canSend(c)) throw new Error("Email isn't set up.")
  if (c.transport === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: c.from,
        ...m,
        attachments: [
          {
            filename: "nimbus.png",
            content: getLogo().toString("base64"),
            content_id: LOGO_CID,
          },
        ],
      }),
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
    .sendMail({
      from: c.from,
      ...m,
      attachments: [
        { filename: "nimbus.png", content: getLogo(), cid: LOGO_CID },
      ],
    })
}

// Auth emails must never fail the request that triggered them, and awaiting the
// send would leak whether an address exists through response timing. The worker
// sends it (/api/jobs) and retries while the mail server is away; with Redis
// away, it goes out from here, once.
export function sendInBackground(m: Message) {
  void import("./redis")
    .then(({ enqueue }) => enqueue("email", m))
    .catch(() => sendNow(m))
    .catch((e) => console.error(`[email] "${m.subject}" to ${m.to}:`, e))
}

// Throws when sending fails, so the worker tries again.
export async function sendNow(m: Message) {
  const c = await getEmailConfig()
  if (canSend(c)) await sendWith(c, m)
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!
  )

// One branded layout for every email: heading, a paragraph or two, an optional
// code and at most one button. Table markup and inline styles because Outlook
// and Gmail ignore most CSS.
export function message(opts: {
  to: string
  subject: string
  heading?: string
  lines: string[]
  code?: string
  action?: { label: string; url: string }
  footer?: string
}): Message {
  const { to, subject, heading = subject, lines, code, action, footer } = opts
  const text = [
    heading,
    ...lines,
    ...(code ? [code] : []),
    ...(action ? [`${action.label}: ${action.url}`] : []),
    ...(footer ? [footer] : []),
    `Nimbus · ${appUrl()}`,
  ].join("\n\n")
  const font =
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
  const muted = "color:#737373;font-size:13px;line-height:20px"
  const p = (s: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#404040">${esc(s)}</p>`
  const host = appUrl().replace(/^https?:\/\//, "")
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;${font}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(lines[0] ?? heading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 24px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle"><img src="cid:${LOGO_CID}" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px"></td>
<td style="vertical-align:middle;padding-left:10px;font-size:18px;font-weight:600;color:#171717;letter-spacing:-0.2px">Nimbus</td>
</tr></table></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-top:4px solid #5fd0bb;border-radius:12px;padding:36px 36px 28px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:600;color:#171717;letter-spacing:-0.3px">${esc(heading)}</h1>
${lines.slice(0, 1).map(p).join("")}
${code ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td align="center" style="background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:18px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:30px;font-weight:600;letter-spacing:8px;color:#171717">${esc(code)}</td></tr></table>` : ""}
${lines.slice(1).map(p).join("\n")}
${
  action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:8px;background:#171717"><a href="${esc(action.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${esc(action.label)}</a></td></tr></table>
<p style="margin:0 0 16px;${muted}">Button not working? Paste this link into your browser:<br><a href="${esc(action.url)}" style="color:#0f766e;word-break:break-all">${esc(action.url)}</a></p>`
    : ""
}
${footer ? `<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #e4e4e7;${muted}">${esc(footer)}</p>` : ""}
</td></tr>
<tr><td align="center" style="padding:24px 16px 0;${muted}">Sent by Nimbus at <a href="${esc(appUrl())}" style="color:#737373;text-decoration:underline">${esc(host)}</a><br>This is an automated message; replies aren't read.</td></tr>
</table></td></tr></table></body></html>`
  return { to, subject, text, html }
}

export function appUrl(path = "") {
  return `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}${path}`
}
