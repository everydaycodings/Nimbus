// The bell and its emails. Every event lands in `notifications`; email goes out
// and the bell keeps it unless the person turned that off for the kind in
// /account. Edits and file drops fold into one unread row per folder per hour,
// and only the first of those emails.
import "server-only"

import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm"

import { accessTo, visiblePath } from "@/lib/access"
import { db } from "@/lib/db"
import {
  NOTIFICATION_KINDS,
  nodes,
  notificationPrefs,
  notifications,
  ownershipTransfers,
  user,
  type NotificationKind,
} from "@/lib/db/schema"
import { appUrl, message, sendInBackground } from "@/lib/email"
import { KIND_LABEL, type Kind } from "@/lib/backup-rules"
import { SERVICE_LABEL, type Service } from "@/lib/health-rules"

type Event = {
  nodeId?: string | null
  actorId?: string | null
  data?: Record<string, string>
}

const DIGEST: NotificationKind[] = ["edits", "file_drop"]

export async function notify(
  userId: string,
  kind: NotificationKind,
  e: Event = {}
) {
  if (e.actorId === userId) return
  if (DIGEST.includes(kind) && e.nodeId) {
    const [bumped] = await db
      .update(notifications)
      .set({ count: sql`${notifications.count} + 1` })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.kind, kind),
          eq(notifications.nodeId, e.nodeId),
          isNull(notifications.readAt),
          gt(notifications.createdAt, sql`now() - interval '1 hour'`)
        )
      )
      .returning({ id: notifications.id })
    if (bumped) return
  }
  const [row] = await db
    .insert(notifications)
    .values({
      userId,
      kind,
      nodeId: e.nodeId ?? null,
      actorId: e.actorId ?? null,
      data: e.data ?? null,
    })
    .returning({ id: notifications.id })
  const [pref] = await db
    .select({ email: notificationPrefs.email, bell: notificationPrefs.bell })
    .from(notificationPrefs)
    .where(
      and(
        eq(notificationPrefs.userId, userId),
        eq(notificationPrefs.kind, kind)
      )
    )
  if (!pref || pref.email) await email(userId, row.id)
  // Bell off: the row was only there to word the email.
  // ponytail: with nothing unread to fold into, edits and file drops then email every time.
  if (pref && !pref.bell)
    await db.delete(notifications).where(eq(notifications.id, row.id))
}

// An editor changed something in a folder shared with them: tell the owner,
// about the highest folder the editor sees.
export async function notifyEdit(actorId: string, nodeId: string) {
  const [top] = await visiblePath(actorId, nodeId)
  if (!top) return
  const [n] = await db
    .select({ ownerId: nodes.ownerId })
    .from(nodes)
    .where(eq(nodes.id, top.id))
  if (n) await notify(n.ownerId, "edits", { nodeId: top.id, actorId })
}

async function email(userId: string, id: string) {
  const [n] = await describe(userId, [id])
  const [to] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
  if (!n || !to) return
  sendInBackground(
    message({
      to: to.email,
      subject: n.text,
      heading: "New activity in Nimbus",
      lines: [n.text],
      action: { label: "Open Nimbus", url: appUrl(n.href) },
      footer: "Choose which emails you get under Account in Nimbus.",
    })
  )
}

export type Notification = {
  id: string
  kind: NotificationKind
  text: string
  href: string
  read: boolean
  createdAt: string
  nodeId: string | null
  // A transfer still waiting for an answer.
  pending: boolean
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

// Notifications as sentences, newest first.
async function describe(userId: string, ids?: string[]) {
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      nodeId: notifications.nodeId,
      count: notifications.count,
      data: notifications.data,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actor: sql<string | null>`(select coalesce(nullif(name, ''), email)
        from "user" where id = ${notifications.actorId})`,
      name: nodes.name,
      kindOf: nodes.kind,
      parentId: nodes.parentId,
      ownerId: nodes.ownerId,
    })
    .from(notifications)
    .leftJoin(nodes, eq(nodes.id, notifications.nodeId))
    .where(
      and(
        eq(notifications.userId, userId),
        ids ? inArray(notifications.id, ids) : undefined
      )
    )
    .orderBy(desc(notifications.createdAt))
    .limit(50)
  const access = await accessTo(
    userId,
    rows.flatMap((r) => (r.nodeId ? [r.nodeId] : []))
  )
  const offers = new Set(
    (
      await db
        .select({ nodeId: ownershipTransfers.nodeId })
        .from(ownershipTransfers)
        .where(eq(ownershipTransfers.toId, userId))
    ).map((o) => o.nodeId)
  )
  return rows.map((r): Notification => {
    const who = r.actor ?? "Someone"
    const item = `“${r.name ?? "an item"}”`
    const d = r.data ?? {}
    const text = {
      shared: `${who} shared ${item} with you as ${d.role ?? "viewer"}`,
      access_changed: `${who} made you ${d.role ?? "viewer"} of ${item}`,
      access_removed: `${who} removed your access to ${d.name ? `“${d.name}”` : item}`,
      file_drop: `${d.uploader || "Someone"} uploaded ${plural(r.count, "file")} to ${item} through ${d.link ? `the link “${d.link}”` : "a link"}`,
      edits: `${who} made ${plural(r.count, "change")} in ${item}`,
      transfer: `${who} wants to make you the owner of ${item}`,
      signup_request: `${d.who ?? who} asked to join Nimbus`,
      service_health: `${SERVICE_LABEL[d.service as Service] ?? "A service"} ${d.state === "up" ? "is working again" : "is down"}`,
      app_password: `A new app password “${d.name ?? "unnamed"}” was made for your account${d.ip ? ` from ${d.ip}` : ""}. Revoke it in Account if it wasn't you.`,
      backup: `${KIND_LABEL[d.backup as Kind] ?? "A"} backup ${d.event === "stale" ? "hasn't succeeded in a while" : d.event === "warning" ? "finished with a warning" : "failed"}`,
    }[r.kind]
    const seen = r.nodeId ? access.get(r.nodeId) : undefined
    const href =
      r.kind === "signup_request"
        ? "/admin/approvals"
        : r.kind === "service_health"
          ? `/admin/system/health#health-${d.service}`
          : r.kind === "backup"
            ? `/admin/system/backups/history?run=${d.run}`
          : r.kind === "app_password"
            ? "/account#connect"
          : !seen
            ? "/shared"
            : r.kindOf === "folder"
              ? `/folders/${r.nodeId}`
              : r.parentId && seen.role === "owner"
                ? `/folders/${r.parentId}`
                : seen.role === "owner"
                  ? "/"
                  : "/shared"
    return {
      id: r.id,
      kind: r.kind,
      text,
      href,
      read: Boolean(r.readAt),
      createdAt: r.createdAt.toISOString(),
      nodeId: r.nodeId,
      pending: r.kind === "transfer" && offers.has(r.nodeId!),
    }
  })
}

export const listNotifications = (userId: string) => describe(userId)

export async function unreadCount(userId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
  return row?.n ?? 0
}

// Where each kind of notification goes; both channels are on until turned off.
export async function channelPrefs(userId: string) {
  const rows = await db
    .select({
      kind: notificationPrefs.kind,
      email: notificationPrefs.email,
      bell: notificationPrefs.bell,
    })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, userId))
  const by = new Map(rows.map((r) => [r.kind, r]))
  return NOTIFICATION_KINDS.map((kind) => ({
    kind,
    email: by.get(kind)?.email ?? true,
    bell: by.get(kind)?.bell ?? true,
  }))
}
