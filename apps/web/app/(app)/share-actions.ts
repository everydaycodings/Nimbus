"use server"

import { and, desc, eq, ilike, isNotNull, ne, or, sql } from "drizzle-orm"
import type { PgUpdateSetSource } from "drizzle-orm/pg-core"
import { refresh } from "next/cache"

import { accessOne, mayShare } from "@/lib/access"
import { db } from "@/lib/db"
import {
  linkEvents,
  nodes,
  ownershipTransfers,
  shares,
  user,
} from "@/lib/db/schema"
import { appUrl, emailEnabled, message, sendInBackground } from "@/lib/email"
import { UUID } from "@/lib/files"
import { hashLinkPassword, newLinkToken } from "@/lib/links"
import { notify } from "@/lib/notify"
import { spaceLeft } from "@/lib/quota"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { freeName, signToken } from "@/lib/upload-rules"

type Result = { error?: string }
type Role = "viewer" | "editor"

const NOT_ALLOWED = "You can't share this. Ask its owner."
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DAY = 24 * 60 * 60 * 1000
const isRole = (r: unknown): r is Role => r === "viewer" || r === "editor"

export type Person = {
  shareId: string
  userId: string | null
  name: string
  email: string
  image: string | null
  role: Role
  // An email invite for someone without an account yet.
  invited: boolean
  // Access that comes from a folder above, managed there.
  through: string | null
  // Owners manage every share; editors only the ones they made.
  canManage: boolean
}

export type LinkInfo = {
  id: string
  token: string
  name: string
  expiresAt: string | null
  hasPassword: boolean
  allowView: boolean
  allowDownload: boolean
  allowUpload: boolean
  uploadCapBytes: number | null
  viewCount: number
  downloadCount: number
  lastOpenedAt: string | null
  canManage: boolean
}

export type ShareState = {
  name: string
  kind: "file" | "folder"
  isOwner: boolean
  owner: { name: string; email: string; image: string | null }
  people: Person[]
  links: LinkInfo[]
  allowReshare: boolean
  publicLinks: boolean
  maxLinkDays: number | null
  requireLinkPassword: boolean
  // Email invites need sign-ups to be possible.
  canInvite: boolean
  emailOn: boolean
  transferTo: { name: string; email: string } | null
}

export async function getShareState(
  nodeId: string
): Promise<ShareState | null> {
  const me = await requireMember()
  if (typeof nodeId !== "string" || !UUID.test(nodeId)) return null
  const a = await mayShare(me.id, nodeId)
  if (!a) return null
  const isOwner = a.role === "owner"

  const [[node], direct, inherited, links, settings, emailOn, [transfer]] =
    await Promise.all([
      db
        .select({
          name: nodes.name,
          kind: nodes.kind,
          allowReshare: nodes.allowReshare,
          owner: user.name,
          ownerEmail: user.email,
          ownerImage: user.image,
        })
        .from(nodes)
        .innerJoin(user, eq(user.id, nodes.ownerId))
        .where(eq(nodes.id, nodeId)),
      db
        .select({
          shareId: shares.id,
          userId: shares.granteeId,
          granteeEmail: shares.granteeEmail,
          name: user.name,
          email: user.email,
          image: user.image,
          role: shares.role,
          createdBy: shares.createdBy,
        })
        .from(shares)
        .leftJoin(user, eq(user.id, shares.granteeId))
        .where(
          and(
            eq(shares.nodeId, nodeId),
            or(isNotNull(shares.granteeId), isNotNull(shares.granteeEmail))
          )
        )
        .orderBy(shares.createdAt),
      db.execute<{
        share_id: string
        user_id: string
        name: string
        email: string
        image: string | null
        role: Role
        through: string
      }>(sql`
        with recursive up as (
          select id, parent_id, name from nodes where id = (
            select parent_id from nodes where id = ${nodeId})
          union all
          select n.id, n.parent_id, n.name from nodes n join up on n.id = up.parent_id
        )
        select s.id as share_id, u.id as user_id, u.name, u.email, u.image,
          s.role, up.name as through
        from up join shares s on s.node_id = up.id
        join "user" u on u.id = s.grantee_id`),
      db
        .select()
        .from(shares)
        .where(and(eq(shares.nodeId, nodeId), isNotNull(shares.token)))
        .orderBy(shares.createdAt),
      getSettings(),
      emailEnabled(),
      db
        .select({ name: user.name, email: user.email })
        .from(ownershipTransfers)
        .innerJoin(user, eq(user.id, ownershipTransfers.toId))
        .where(eq(ownershipTransfers.nodeId, nodeId)),
    ])
  if (!node) return null

  const people: Person[] = direct.map((p) => ({
    shareId: p.shareId,
    userId: p.userId,
    name: p.name ?? p.granteeEmail ?? "",
    email: p.email ?? p.granteeEmail ?? "",
    image: p.image,
    role: p.role,
    invited: !p.userId,
    through: null,
    canManage: isOwner || p.createdBy === me.id,
  }))
  const seen = new Set(people.map((p) => p.userId))
  for (const p of inherited)
    if (!seen.has(p.user_id)) {
      seen.add(p.user_id)
      people.push({
        shareId: p.share_id,
        userId: p.user_id,
        name: p.name,
        email: p.email,
        image: p.image,
        role: p.role,
        invited: false,
        through: p.through,
        canManage: false,
      })
    }

  return {
    name: node.name,
    kind: node.kind,
    isOwner,
    owner: { name: node.owner, email: node.ownerEmail, image: node.ownerImage },
    people,
    links: links.map((l) => ({
      id: l.id,
      token: l.token!,
      name: l.name ?? "Link",
      expiresAt: l.expiresAt?.toISOString() ?? null,
      hasPassword: Boolean(l.passwordHash),
      allowView: l.allowView,
      allowDownload: l.allowDownload,
      allowUpload: l.allowUpload,
      uploadCapBytes: l.uploadCapBytes,
      viewCount: l.viewCount,
      downloadCount: l.downloadCount,
      lastOpenedAt: l.lastOpenedAt?.toISOString() ?? null,
      canManage: isOwner || l.createdBy === me.id,
    })),
    allowReshare: node.allowReshare,
    publicLinks: settings.publicLinksEnabled,
    maxLinkDays: settings.maxLinkDays,
    requireLinkPassword: settings.requireLinkPassword,
    canInvite: settings.signupMode !== "closed",
    emailOn,
    transferTo: transfer ?? null,
  }
}

// Active members matching a name or email, for the add-people field.
export async function findMembers(q: string) {
  const me = await requireMember()
  const term = String(q ?? "").trim()
  if (term.length < 2) return []
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(user)
    .where(
      and(
        eq(user.status, "active"),
        ne(user.id, me.id),
        or(ilike(user.name, like), ilike(user.email, like))
      )
    )
    .orderBy(user.name)
    .limit(8)
}

// Shares with a member, or invites an email that has no account yet.
export async function shareWith(
  nodeId: string,
  target: string,
  role: Role
): Promise<Result> {
  const me = await requireMember()
  if (!isRole(role) || typeof target !== "string")
    return { error: "Pick a role." }
  const a = await mayShare(me.id, nodeId)
  if (!a) return { error: NOT_ALLOWED }

  const [member] = await db
    .select({ id: user.id, status: user.status, email: user.email })
    .from(user)
    .where(
      UUID.test(target) || !target.includes("@")
        ? eq(user.id, target)
        : sql`lower(${user.email}) = lower(${target.trim()})`
    )
  if (member) {
    if (member.id === a.ownerId) return { error: "They already own it." }
    if (member.id === me.id) return { error: "You already have access." }
    if (member.status !== "active")
      return { error: "That account isn't approved yet." }
    const [existing] = await db
      .select({ id: shares.id, role: shares.role })
      .from(shares)
      .where(and(eq(shares.nodeId, nodeId), eq(shares.granteeId, member.id)))
    if (existing) {
      if (existing.role === role) return {}
      return setShareRole(existing.id, role)
    }
    await db
      .insert(shares)
      .values({ nodeId, granteeId: member.id, role, createdBy: me.id })
    await notify(member.id, "shared", {
      nodeId,
      actorId: me.id,
      data: { role },
    })
    refresh()
    return {}
  }

  const email = target.trim().toLowerCase()
  if (!EMAIL.test(email)) return { error: "Pick someone or type an email." }
  const settings = await getSettings()
  if (settings.signupMode === "closed")
    return {
      error:
        "Sign-ups are closed on this Nimbus, so only members can be added.",
    }
  if (!(await emailEnabled()))
    return {
      error:
        "This Nimbus can't send email, so invites can't reach anyone. Ask them to sign up first.",
    }
  const [row] = await db
    .insert(shares)
    .values({ nodeId, granteeEmail: email, role, createdBy: me.id })
    .onConflictDoNothing()
    .returning({ id: shares.id })
  if (!row) return { error: "They're already invited." }
  const [n] = await db
    .select({ name: nodes.name })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
  const token = signToken("share-invite", { s: row.id, e: email }, 30 * DAY)
  sendInBackground(
    message({
      to: email,
      subject: `${me.name} shared “${n.name}” with you on Nimbus`,
      heading: `${me.name} shared “${n.name}” with you`,
      lines: [
        `${me.name} (${me.email}) shared “${n.name}” with you as ${role}.`,
        "Create your account to open it. This invite works for 30 days.",
      ],
      action: {
        label: "Join and open",
        url: appUrl(`/invite/share/${token}`),
      },
    })
  )
  refresh()
  return {}
}

// The share if the user may manage it.
async function manageable(userId: string, shareId: string) {
  if (typeof shareId !== "string" || !UUID.test(shareId)) return null
  const [s] = await db
    .select({
      id: shares.id,
      nodeId: shares.nodeId,
      granteeId: shares.granteeId,
      createdBy: shares.createdBy,
      token: shares.token,
      name: nodes.name,
    })
    .from(shares)
    .innerJoin(nodes, eq(nodes.id, shares.nodeId))
    .where(eq(shares.id, shareId))
  if (!s) return null
  const a = await mayShare(userId, s.nodeId)
  if (!a || (a.role !== "owner" && s.createdBy !== userId)) return null
  return s
}

export async function setShareRole(
  shareId: string,
  role: Role
): Promise<Result> {
  const me = await requireMember()
  if (!isRole(role)) return { error: "Pick a role." }
  const s = await manageable(me.id, shareId)
  if (!s || s.token) return { error: NOT_ALLOWED }
  await db.update(shares).set({ role }).where(eq(shares.id, s.id))
  if (s.granteeId)
    await notify(s.granteeId, "access_changed", {
      nodeId: s.nodeId,
      actorId: me.id,
      data: { role },
    })
  refresh()
  return {}
}

export async function removeShare(shareId: string): Promise<Result> {
  const me = await requireMember()
  const s = await manageable(me.id, shareId)
  if (!s) return { error: NOT_ALLOWED }
  await db.delete(shares).where(eq(shares.id, s.id))
  if (s.granteeId)
    await notify(s.granteeId, "access_removed", {
      nodeId: s.nodeId,
      actorId: me.id,
      data: { name: s.name },
    })
  refresh()
  return {}
}

export async function setAllowReshare(
  nodeId: string,
  on: boolean
): Promise<Result> {
  const me = await requireMember()
  const a = await accessOne(me.id, nodeId)
  if (a?.role !== "owner") return { error: "Only the owner can change this." }
  await db
    .update(nodes)
    .set({ allowReshare: Boolean(on) })
    .where(eq(nodes.id, nodeId))
  return {}
}

// Expiry as an ISO date, capped by the admin's maximum. Undefined: no change.
async function linkExpiry(raw: string | null | undefined) {
  const { maxLinkDays } = await getSettings()
  const cap = maxLinkDays ? new Date(Date.now() + maxLinkDays * DAY) : null
  if (raw === undefined) return { value: undefined }
  if (raw === null || raw === "") {
    if (cap)
      return {
        error: `Links on this Nimbus expire within ${maxLinkDays} days.`,
      }
    return { value: null }
  }
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) return { error: "Pick a valid date." }
  if (at.getTime() <= Date.now()) return { error: "Pick a date in the future." }
  if (cap && at > cap)
    return { error: `Links on this Nimbus expire within ${maxLinkDays} days.` }
  return { value: at }
}

export async function createLink(
  nodeId: string,
  opts: { name?: string; password?: string } = {}
): Promise<Result & { id?: string }> {
  const me = await requireMember()
  const a = await mayShare(me.id, nodeId)
  if (!a) return { error: NOT_ALLOWED }
  const settings = await getSettings()
  if (!settings.publicLinksEnabled)
    return { error: "Your admin turned public links off." }
  const password = String(opts.password ?? "")
  if (settings.requireLinkPassword && !password)
    return { error: "Links on this Nimbus need a password." }
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(shares)
    .where(and(eq(shares.nodeId, nodeId), isNotNull(shares.token)))
  const [row] = await db
    .insert(shares)
    .values({
      nodeId,
      token: newLinkToken(),
      createdBy: me.id,
      name:
        String(opts.name ?? "")
          .trim()
          .slice(0, 80) || `Link ${n + 1}`,
      passwordHash: password ? await hashLinkPassword(password) : null,
      expiresAt: settings.maxLinkDays
        ? new Date(Date.now() + settings.maxLinkDays * DAY)
        : null,
    })
    .returning({ id: shares.id })
  refresh()
  return { id: row.id }
}

export type LinkPatch = {
  name?: string
  expiresAt?: string | null
  // "" removes it.
  password?: string
  allowView?: boolean
  allowDownload?: boolean
  allowUpload?: boolean
  uploadCapBytes?: number | null
}

export async function updateLink(
  shareId: string,
  patch: LinkPatch
): Promise<Result> {
  const me = await requireMember()
  const s = await manageable(me.id, shareId)
  if (!s?.token) return { error: NOT_ALLOWED }
  const set: PgUpdateSetSource<typeof shares> = {}
  if (patch.name !== undefined) {
    const name = String(patch.name).trim().slice(0, 80)
    if (!name) return { error: "Give the link a name." }
    set.name = name
  }
  const exp = await linkExpiry(patch.expiresAt)
  if (exp.error) return { error: exp.error }
  if (exp.value !== undefined) set.expiresAt = exp.value
  if (patch.password !== undefined) {
    const pw = String(patch.password)
    if (!pw && (await getSettings()).requireLinkPassword)
      return { error: "Links on this Nimbus need a password." }
    if (pw && pw.length < 4) return { error: "Use at least 4 characters." }
    set.passwordHash = pw ? await hashLinkPassword(pw) : null
    set.pwRev = sql`${shares.pwRev} + 1`
  }
  for (const k of ["allowView", "allowDownload", "allowUpload"] as const)
    if (patch[k] !== undefined) set[k] = Boolean(patch[k])
  if (patch.uploadCapBytes !== undefined) {
    const cap = patch.uploadCapBytes
    if (cap !== null && !(Number.isFinite(cap) && cap > 0))
      return { error: "Enter a size above zero, or leave it blank." }
    set.uploadCapBytes = cap === null ? null : Math.round(cap)
  }
  if (set.allowView === false && set.allowUpload === false)
    return { error: "A link has to show the files or take uploads." }
  await db.update(shares).set(set).where(eq(shares.id, s.id))
  refresh()
  return {}
}

export async function deleteLink(shareId: string): Promise<Result> {
  const me = await requireMember()
  const s = await manageable(me.id, shareId)
  if (!s?.token) return { error: NOT_ALLOWED }
  await db.delete(shares).where(eq(shares.id, s.id))
  refresh()
  return {}
}

export type LinkEvent = {
  kind: string
  ip: string | null
  ua: string | null
  detail: string | null
  at: string
}

export async function listLinkEvents(
  shareId: string,
  limit = 20
): Promise<LinkEvent[]> {
  const me = await requireMember()
  const s = await manageable(me.id, shareId)
  if (!s?.token) return []
  const rows = await db
    .select()
    .from(linkEvents)
    .where(eq(linkEvents.shareId, s.id))
    .orderBy(desc(linkEvents.at))
    .limit(Math.min(Math.max(1, Number(limit) || 20), 500))
  return rows.map((r) => ({
    kind: r.kind,
    ip: r.ip,
    ua: r.ua,
    detail: r.detail,
    at: r.at.toISOString(),
  }))
}

// Asks a member to take over an item. Nothing moves until they accept.
export async function offerOwnership(
  nodeId: string,
  toUserId: string
): Promise<Result> {
  const me = await requireMember()
  const a = await accessOne(me.id, nodeId)
  if (a?.role !== "owner" || a.trashed)
    return { error: "Only the owner can hand this over." }
  const [to] = await db
    .select({ id: user.id, status: user.status })
    .from(user)
    .where(eq(user.id, String(toUserId)))
  if (!to || to.status !== "active" || to.id === me.id)
    return { error: "Pick another active member." }
  await db
    .insert(ownershipTransfers)
    .values({ nodeId, fromId: me.id, toId: to.id })
    .onConflictDoUpdate({
      target: ownershipTransfers.nodeId,
      set: { toId: to.id, createdAt: new Date() },
    })
  await notify(to.id, "transfer", { nodeId, actorId: me.id })
  refresh()
  return {}
}

export async function cancelOwnershipOffer(nodeId: string): Promise<Result> {
  const me = await requireMember()
  if (typeof nodeId !== "string" || !UUID.test(nodeId)) return {}
  await db
    .delete(ownershipTransfers)
    .where(
      and(
        eq(ownershipTransfers.nodeId, nodeId),
        eq(ownershipTransfers.fromId, me.id)
      )
    )
  refresh()
  return {}
}

// The new owner takes the item into their My files with everything inside it.
// The old owner keeps edit access. Everything moves or nothing does.
export async function answerOwnership(
  nodeId: string,
  accept: boolean
): Promise<Result> {
  const me = await requireMember()
  if (typeof nodeId !== "string" || !UUID.test(nodeId)) return {}
  const [offer] = await db
    .select()
    .from(ownershipTransfers)
    .where(
      and(
        eq(ownershipTransfers.nodeId, nodeId),
        eq(ownershipTransfers.toId, me.id)
      )
    )
  if (!offer) return { error: "That offer was withdrawn." }
  if (!accept) {
    await db
      .delete(ownershipTransfers)
      .where(eq(ownershipTransfers.nodeId, nodeId))
    refresh()
    return {}
  }

  const [node] = await db
    .select({
      name: nodes.name,
      ownerId: nodes.ownerId,
      trashedAt: nodes.trashedAt,
    })
    .from(nodes)
    .where(eq(nodes.id, nodeId))
  if (!node || node.trashedAt || node.ownerId !== offer.fromId) {
    await db
      .delete(ownershipTransfers)
      .where(eq(ownershipTransfers.nodeId, nodeId))
    return { error: "That item isn't available any more." }
  }
  const [{ bytes }] = await db.execute<{ bytes: string }>(sql`
    with recursive t as (
      select id from nodes where id = ${nodeId}
      union all
      select n.id from nodes n join t on n.parent_id = t.id
    )
    select coalesce(sum(size), 0)::text as bytes from (
      select distinct on (fv.s3_key) fv.size from file_versions fv
      where fv.node_id in (select id from t)
    ) k`)
  const left = await spaceLeft(me.id)
  if (left !== null && Number(bytes) > left)
    return { error: "You don't have enough space for this." }

  await db.transaction(async (tx) => {
    const taken = await tx
      .select({ name: sql<string>`lower(${nodes.name})` })
      .from(nodes)
      .where(
        and(
          eq(nodes.ownerId, me.id),
          sql`${nodes.parentId} is null and ${nodes.trashedAt} is null`
        )
      )
    const names = new Set(taken.map((t) => t.name))
    const name = names.has(node.name.toLowerCase())
      ? freeName(node.name, names, true)
      : node.name
    await tx.execute(sql`
      with recursive t as (
        select id from nodes where id = ${nodeId}
        union all
        select n.id from nodes n join t on n.parent_id = t.id
      )
      update nodes set owner_id = ${me.id} where id in (select id from t)`)
    await tx
      .update(nodes)
      .set({ parentId: null, name, updatedAt: new Date() })
      .where(eq(nodes.id, nodeId))
    // Their own access goes; the old owner becomes an editor.
    await tx
      .delete(shares)
      .where(and(eq(shares.nodeId, nodeId), eq(shares.granteeId, me.id)))
    await tx
      .insert(shares)
      .values({
        nodeId,
        granteeId: offer.fromId,
        role: "editor",
        createdBy: me.id,
      })
      .onConflictDoUpdate({
        target: [shares.nodeId, shares.granteeId],
        targetWhere: sql`${shares.granteeId} is not null`,
        set: { role: "editor" },
      })
    await tx
      .delete(ownershipTransfers)
      .where(eq(ownershipTransfers.nodeId, nodeId))
  })
  await notify(offer.fromId, "access_changed", {
    nodeId,
    actorId: me.id,
    data: { role: "editor" },
  })
  refresh()
  return {}
}
