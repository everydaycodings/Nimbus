"use server"

import { revalidatePath } from "next/cache"

import { saveSettings } from "@/lib/audit"
import { encrypt } from "@/lib/crypto"
import {
  EMAIL_TRANSPORTS,
  settings,
  type EmailTransport,
} from "@/lib/db/schema"
import { getEmailConfig, message, sendWith } from "@/lib/email"
import { requireAdmin } from "@/lib/session"

export type EmailFormState = { ok?: boolean; error?: string } | null

// "Nimbus <nimbus@example.com>" or a bare address.
const FROM =
  /^([^<>]+<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/

const field = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim()

// Blank secret fields keep what's stored; anything typed is sealed before saving.
export async function saveEmail(
  _: EmailFormState,
  form: FormData
): Promise<EmailFormState> {
  await requireAdmin()
  if ((await getEmailConfig()).source === "env")
    return { error: "Email is set in env, so it can't be changed here." }

  const transport = field(form, "transport") as EmailTransport
  if (!EMAIL_TRANSPORTS.includes(transport))
    return { error: "Pick how Nimbus sends email." }

  if (transport === "none") {
    await saveSettings({ emailTransport: "none", updatedAt: new Date() })
    revalidatePath("/", "layout")
    return { ok: true }
  }

  const from = field(form, "from")
  if (!FROM.test(from))
    return {
      error:
        "Enter a sender like nimbus@example.com or Nimbus <nimbus@example.com>.",
    }

  const update: Partial<typeof settings.$inferInsert> = {
    emailTransport: transport,
    emailFrom: from,
    updatedAt: new Date(),
  }

  if (transport === "smtp") {
    const host = field(form, "host")
    const port = Number(field(form, "port"))
    if (!host) return { error: "Enter your SMTP server's host name." }
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return { error: "The port must be a number from 1 to 65535." }
    const password = String(form.get("password") ?? "")
    Object.assign(update, {
      smtpHost: host,
      smtpPort: port,
      smtpSecure: form.get("secure") === "on",
      smtpUser: field(form, "user") || null,
      ...(password && { smtpPassword: encrypt(password) }),
    })
  } else {
    const key = field(form, "apiKey")
    if (key && !key.startsWith("re_"))
      return { error: "Resend API keys start with re_." }
    if (key) update.resendApiKey = encrypt(key)
    else if (!(await getEmailConfig()).resendApiKey)
      return { error: "Enter your Resend API key." }
  }

  await saveSettings(update)
  revalidatePath("/", "layout")
  return { ok: true }
}

export async function sendTestEmail(): Promise<EmailFormState> {
  const actor = await requireAdmin()
  const config = await getEmailConfig()
  try {
    await sendWith(
      config,
      message({
        to: actor.email,
        subject: "Nimbus can send email",
        heading: "Email is working",
        lines: [
          `This test came from your Nimbus through ${config.transport === "smtp" ? `SMTP (${config.smtp.host})` : "Resend"}.`,
          "Password resets, email confirmation and approval notices will now reach people.",
        ],
      })
    )
  } catch (e) {
    return {
      error: `Couldn't send: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
  return { ok: true }
}
