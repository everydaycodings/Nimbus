// Transfer: copies of files sent by email or link, deleted at expiry. The
// sender's side lives here (web actions and /api/v1/transfers both call it);
// the recipient's page is lib/transfer-links.ts.
import "server-only"

import { randomBytes } from "node:crypto"

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"

import { viewable } from "@/lib/access"
import { db } from "@/lib/db"
import {
  nodes,
  transferEvents,
  transferFiles,
  transferRecipients,
  transfers,
} from "@/lib/db/schema"
import { appUrl, emailEnabled, message, sendInBackground } from "@/lib/email"
import { formatBytes } from "@/lib/file-rules"
import { hashLinkPassword, newLinkToken } from "@/lib/links"
import { spaceLeft } from "@/lib/quota"
import { copyObject, deleteKeys, thumbKey } from "@/lib/s3"
import type { Me } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { signUploadToken, splitPath } from "@/lib/upload-rules"
import { rejectReason, uploadLimits, zipTree } from "@/lib/uploads"
import type {
  Transfer,
  TransferEvent,
  TransferOptions,
} from "@nimbus/shared/api"

export type Result = { error?: string }

const DAY = 24 * 60 * 60 * 1000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NOT_YOURS = "That transfer isn't available."
const MAX_FILES = 500
const MAX_EMAILS = 20
export const newKey = () => randomBytes(16).toString("hex")

export async function transferOptions(): Promise<TransferOptions> {
  const s = await getSettings()
  return {
    enabled: s.transfersEnabled,
    maxDays: s.transferMaxDays ?? 30,
    maxBytes: s.transferMaxBytes,
    email: await emailEnabled(),
  }
}

// 1, 7 and 30 days, up to the admin's cap (at least 1).
export const dayChoices = (maxDays: number) =>
  [1, 7, 30].filter((d) => d <= maxDays).length
    ? [1, 7, 30].filter((d) => d <= maxDays)
    : [1]

type Row = typeof transfers.$inferSelect

function statusOf(t: Row) {
  return t.revokedAt
    ? "revoked"
    : t.expiresAt.getTime() <= Date.now()
      ? "expired"
      : t.downloadLimit !== null && t.downloads >= t.downloadLimit
        ? "closed"
        : "active"
}

async function describe(rows: Row[]): Promise<Transfer[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const [files, recipients] = await Promise.all([
    db
      .select()
      .from(transferFiles)
      .where(inArray(transferFiles.transferId, ids))
      .orderBy(asc(transferFiles.createdAt), asc(transferFiles.name)),
    db
      .select()
      .from(transferRecipients)
      .where(inArray(transferRecipients.transferId, ids))
      .orderBy(asc(transferRecipients.email)),
  ])
  return rows.map((t) => {
    const f = files.filter((x) => x.transferId === t.id)
    const r = recipients.filter((x) => x.transferId === t.id)
    return {
      id: t.id,
      title: t.title,
      message: t.message,
      status: statusOf(t),
      expiresAt: t.expiresAt.toISOString(),
      hasPassword: Boolean(t.passwordHash),
      downloadLimit: t.downloadLimit,
      downloads: t.downloads,
      fileCount: f.length,
      bytes: f.reduce((n, x) => n + x.size, 0),
      createdAt: t.createdAt.toISOString(),
      linkToken: r.find((x) => !x.email)?.token ?? null,
      files: f.map((x) => ({ id: x.id, name: x.name, size: x.size })),
      recipients: r.map((x) => ({
        id: x.id,
        email: x.email,
        downloads: x.downloads,
        lastAt: x.lastAt?.toISOString() ?? null,
      })),
    }
  })
}

// Sent transfers, newest first. Drafts are still being made.
export async function listTransfers(me: Me) {
  const rows = await db
    .select()
    .from(transfers)
    .where(and(eq(transfers.senderId, me.id), eq(transfers.draft, false)))
    .orderBy(desc(transfers.createdAt))
  return describe(rows)
}

const mine = async (me: Me, id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(String(id))) return null
  const [row] = await db
    .select()
    .from(transfers)
    .where(and(eq(transfers.id, id), eq(transfers.senderId, me.id)))
  return row ?? null
}

export async function getTransfer(
  me: Me,
  id: string
): Promise<{ transfer: Transfer; events: TransferEvent[] } | null> {
  const row = await mine(me, id)
  if (!row) return null
  const events = await db
    .select({
      id: transferEvents.id,
      email: transferRecipients.email,
      kind: transferEvents.kind,
      ip: transferEvents.ip,
      ua: transferEvents.ua,
      detail: transferEvents.detail,
      at: transferEvents.at,
    })
    .from(transferEvents)
    .innerJoin(
      transferRecipients,
      eq(transferRecipients.id, transferEvents.recipientId)
    )
    .where(eq(transferRecipients.transferId, id))
    .orderBy(desc(transferEvents.at))
    .limit(100)
  return {
    transfer: (await describe([row]))[0],
    events: events.map((e) => ({
      id: e.id,
      who: e.email ?? "Someone",
      kind: e.kind,
      ip: e.ip,
      ua: e.ua,
      detail: e.detail,
      at: e.at.toISOString(),
    })),
  }
}

export type NewTransfer = {
  nodeIds: string[]
  title?: string
  message?: string
  days: number
  password?: string
  downloadLimit?: number | null
  emails?: string[]
  link?: boolean
}

// Starts a draft: copies the picked Nimbus items (server-side, so no bytes pass
// through here) and makes each recipient's link. Device files are added with
// addFileToken; finalise opens it and sends the emails.
export async function createTransfer(
  me: Me,
  o: NewTransfer
): Promise<Result & { id?: string }> {
  const opts = await transferOptions()
  if (!opts.enabled) return { error: "Your admin turned Transfer off." }
  if (!dayChoices(opts.maxDays).includes(Number(o.days)))
    return { error: "Pick how long it lasts." }
  const emails = [
    ...new Set(
      (o.emails ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)
    ),
  ]
  if (emails.length > MAX_EMAILS)
    return { error: `Send to at most ${MAX_EMAILS} people at a time.` }
  if (emails.some((e) => !EMAIL.test(e)))
    return { error: "One of those emails doesn't look right." }
  if (emails.length && !opts.email)
    return { error: "Email isn't set up here. Copy the link instead." }
  if (!emails.length && !o.link) return { error: "Add an email or a link." }
  const limit = o.downloadLimit ? Math.floor(Number(o.downloadLimit)) : null
  if (limit !== null && !(limit >= 1 && limit <= 10_000))
    return { error: "The download limit must be 1 or more." }

  // Everything picked, folders expanded. Names keep their folder path.
  const ids = Array.isArray(o.nodeIds) ? o.nodeIds.map(String).slice(0, 1000) : []
  const tree = await zipTree(await viewable(me.id, ids))
  const files = tree?.files ?? []
  if (files.length > MAX_FILES)
    return { error: `Send at most ${MAX_FILES} files in one transfer.` }
  const bytes = files.reduce((n, f) => n + f.size, 0)
  if (opts.maxBytes !== null && bytes > opts.maxBytes)
    return { error: `Transfers here can be up to ${formatBytes(opts.maxBytes)}.` }
  const left = await spaceLeft(me.id)
  if (left !== null && bytes > left)
    return {
      error: `This needs ${formatBytes(bytes)}, but only ${formatBytes(left)} is left in your storage.`,
    }

  const password = String(o.password ?? "")
  const [t] = await db
    .insert(transfers)
    .values({
      senderId: me.id,
      title: String(o.title ?? "").trim().slice(0, 100) || null,
      message: String(o.message ?? "").trim().slice(0, 2000) || null,
      expiresAt: new Date(Date.now() + Number(o.days) * DAY),
      passwordHash: password ? await hashLinkPassword(password) : null,
      downloadLimit: limit,
    })
    .returning({ id: transfers.id })
  await db.insert(transferRecipients).values([
    ...emails.map((email) => ({
      transferId: t.id,
      email,
      token: newLinkToken(),
    })),
    ...(o.link ? [{ transferId: t.id, email: null, token: newLinkToken() }] : []),
  ])

  const mimes = new Map(
    (
      await db
        .select({ key: nodes.s3Key, mime: nodes.mime })
        .from(nodes)
        .where(
          inArray(
            nodes.s3Key,
            files.map((f) => f.key)
          )
        )
    ).map((r) => [r.key, r.mime])
  )
  const copied: string[] = []
  try {
    // ponytail: one copy at a time; run a few in parallel if big transfers feel slow.
    for (const f of files) {
      const key = newKey()
      await copyObject(f.key, key)
      copied.push(key)
      // The thumbnail, when the file has one, so the recipient's page shows it.
      const thumb = await copyObject(thumbKey(f.key), thumbKey(key)).then(
        () => true,
        () => false
      )
      await db.insert(transferFiles).values({
        transferId: t.id,
        name: f.path,
        size: f.size,
        mime: mimes.get(f.key) ?? null,
        s3Key: key,
        thumb,
      })
    }
  } catch (e) {
    console.error("[transfer] copy failed", e)
    await db.delete(transfers).where(eq(transfers.id, t.id))
    await deleteKeys(copied)
    return { error: "Couldn't copy the files. Try again." }
  }
  return { id: t.id }
}

// Permission to upload one device file into a draft transfer (tus metadata
// `token`; then finish it like any upload).
export async function addFileToken(
  me: Me,
  id: string,
  name: string,
  size: number
): Promise<Result & { token?: string }> {
  const t = await mine(me, id)
  if (!t || !t.draft || t.revokedAt) return { error: NOT_YOURS }
  if (!splitPath(name)) return { error: "That name can't be used." }
  const bytes = Number(size) || 0
  const reason = rejectReason(name, bytes, await uploadLimits())
  if (reason) return { error: reason }
  const opts = await transferOptions()
  if (opts.maxBytes !== null) {
    const [held] = await db
      .select({ n: sql<string>`coalesce(sum(${transferFiles.size}), 0)::text` })
      .from(transferFiles)
      .where(eq(transferFiles.transferId, id))
    if (Number(held.n) + bytes > opts.maxBytes)
      return {
        error: `Transfers here can be up to ${formatBytes(opts.maxBytes)}.`,
      }
  }
  const left = await spaceLeft(me.id)
  if (left !== null && bytes > left)
    return {
      error: `There's only ${formatBytes(left)} of space left in your storage.`,
    }
  return { token: signUploadToken(me.id, null, Date.now(), { x: id }) }
}

// Opens the transfer and emails its recipients. The clock starts now.
export async function finaliseTransfer(
  me: Me,
  id: string
): Promise<Result & { transfer?: Transfer }> {
  const t = await mine(me, id)
  if (!t || t.revokedAt) return { error: NOT_YOURS }
  if (!t.draft) return { transfer: (await describe([t]))[0] }
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transferFiles)
    .where(eq(transferFiles.transferId, id))
  if (!n) return { error: "Add at least one file first." }
  const expiresAt = new Date(
    Date.now() + (t.expiresAt.getTime() - t.createdAt.getTime())
  )
  const [open] = await db
    .update(transfers)
    .set({ draft: false, expiresAt })
    .where(and(eq(transfers.id, id), eq(transfers.draft, true)))
    .returning()
  // A second call (a double click) finds it open already and sends nothing.
  if (!open) return { transfer: (await describe([t]))[0] }

  const [info] = await describe([open])
  const who = me.name || me.email
  const title = open.title || (n === 1 ? info.files[0].name : `${n} files`)
  for (const r of info.recipients.filter((x) => x.email)) {
    const [{ token }] = await db
      .select({ token: transferRecipients.token })
      .from(transferRecipients)
      .where(eq(transferRecipients.id, r.id))
    sendInBackground(
      message({
        to: r.email!,
        subject: `${who} sent you ${n === 1 ? "a file" : `${n} files`}`,
        heading: title,
        lines: [
          `${who} sent you ${n === 1 ? "a file" : `${n} files`} (${formatBytes(info.bytes)}) with Nimbus.`,
          ...(open.message ? [open.message] : []),
          `It's available until ${expiresAt.toLocaleDateString("en", { dateStyle: "long" })}.${open.passwordHash ? " It has a password, so ask them for it." : ""}`,
        ],
        action: { label: "Open the files", url: appUrl(`/t/${token}`) },
        footer: "You get this because someone entered your email in Nimbus.",
      })
    )
  }
  return { transfer: info }
}

// Stops the links now and frees the sender's space. The hourly purge deletes
// the copies.
export async function revokeTransfer(me: Me, id: string): Promise<Result> {
  const t = await mine(me, id)
  if (!t) return { error: NOT_YOURS }
  await db
    .update(transfers)
    .set({ revokedAt: new Date() })
    .where(and(eq(transfers.id, id), isNull(transfers.revokedAt)))
  return {}
}

// Hourly: expired and revoked transfers, and drafts left over a day, go with
// their files.
export async function purgeTransfers() {
  const gone = await db
    .select({ id: transfers.id })
    .from(transfers)
    .where(
      sql`${transfers.expiresAt} <= now() or ${transfers.revokedAt} is not null
        or (${transfers.draft} and ${transfers.createdAt} < now() - interval '1 day')`
    )
  if (!gone.length) return
  const ids = gone.map((g) => g.id)
  const keys = await db
    .select({ key: transferFiles.s3Key })
    .from(transferFiles)
    .where(inArray(transferFiles.transferId, ids))
  await db.delete(transfers).where(inArray(transfers.id, ids))
  await deleteKeys(keys.map((k) => k.key))
}
