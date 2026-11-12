// Comment threads on files. Anyone with access may comment (viewers too); the owner and editors may
// delete any comment and resolve any thread. Vault files never get here (accessTo skips them).
import "server-only"

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import {
  MAX_COMMENT,
  REACTIONS,
  commentParts,
  mentionIds,
} from "@nimbus/shared/comments"
import type {
  Comment,
  CommentPerson,
  CommentsResponse,
  CommentThread,
} from "@nimbus/shared/api"

import { accessOne, atLeast } from "@/lib/access"
import { recordOne } from "@/lib/activity"
import { db } from "@/lib/db"
import { commentReactions, comments, user } from "@/lib/db/schema"
import { publishEvent } from "@/lib/events"
import { UUID } from "@/lib/file-rules"
import { notify } from "@/lib/notify"
import type { Me } from "@/lib/session"

const GONE = "This file isn't available anymore."

// Live updates for whoever has the file's comments open: GET /api/v1/files/{id}/comments/events.
export const commentChannel = (nodeId: string) => `node:${nodeId}`
const changed = (nodeId: string) => publishEvent(commentChannel(nodeId), "comment")

async function fileAccess(me: Me, id: string) {
  if (!UUID.test(id)) return null
  const a = await accessOne(me.id, id)
  if (!a || a.kind !== "file" || (a.trashed && a.role !== "owner")) return null
  return a
}

// The owner and everyone the file or a folder above it is shared with.
async function peopleWithAccess(nodeId: string) {
  const rows = await db.execute<{ id: string }>(sql`
    with recursive up as (
      select id, parent_id, owner_id from nodes where id = ${nodeId}
      union all
      select n.id, n.parent_id, n.owner_id from nodes n join up on n.id = up.parent_id
    )
    select owner_id as id from nodes where id = ${nodeId}
    union
    select s.grantee_id from shares s join up on s.node_id = up.id
    where s.grantee_id is not null`)
  return new Set(rows.map((r) => r.id))
}

export async function listComments(
  me: Me,
  id: string
): Promise<CommentsResponse | null> {
  const a = await fileAccess(me, id)
  if (!a) return null
  const rows = await db
    .select()
    .from(comments)
    .where(eq(comments.nodeId, id))
    .orderBy(asc(comments.createdAt))
  const reactions = rows.length
    ? await db
        .select({
          commentId: commentReactions.commentId,
          emoji: commentReactions.emoji,
          count: sql<number>`count(*)::int`,
          mine: sql<boolean>`bool_or(${commentReactions.userId} = ${me.id})`,
        })
        .from(commentReactions)
        .where(
          inArray(
            commentReactions.commentId,
            rows.map((r) => r.id)
          )
        )
        .groupBy(commentReactions.commentId, commentReactions.emoji)
    : []
  const order = (e: string) => REACTIONS.indexOf(e as never)
  const toComment = (r: (typeof rows)[number]): Comment => ({
    id: r.id,
    authorId: r.authorId,
    body: r.deletedAt ? null : r.body,
    atSeconds: r.atSeconds,
    page: r.page,
    createdAt: r.createdAt.toISOString(),
    editedAt: r.editedAt?.toISOString() ?? null,
    reactions: reactions
      .filter((x) => x.commentId === r.id)
      .sort((x, y) => order(x.emoji) - order(y.emoji))
      .map(({ emoji, count, mine }) => ({ emoji, count, mine })),
  })
  const threads: CommentThread[] = rows
    .filter((r) => !r.parentId)
    .map((r) => ({
      ...toComment(r),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedBy: r.resolvedBy,
      replies: rows.filter((x) => x.parentId === r.id).map(toComment),
    }))
  const access = await peopleWithAccess(id)
  const named = new Set([
    ...access,
    ...rows.flatMap((r) => [r.authorId, r.resolvedBy, ...r.mentions]),
  ])
  named.delete(null)
  const people: CommentPerson[] = (
    await db
      .select({
        id: user.id,
        name: sql<string>`coalesce(nullif(${user.name}, ''), ${user.email})`,
        image: user.image,
      })
      .from(user)
      .where(inArray(user.id, [...named] as string[]))
  ).map((p) => ({ ...p, mentionable: access.has(p.id) }))
  return {
    me: me.id,
    threads,
    people,
    canModerate: atLeast(a.role, "editor"),
    canComment: !a.trashed,
  }
}

const cleanBody = (raw: unknown) => {
  if (typeof raw !== "string") return { error: "Write something first." }
  const body = raw.trim()
  if (!body) return { error: "Write something first." }
  if (body.length > MAX_COMMENT)
    return { error: `Keep it under ${MAX_COMMENT.toLocaleString()} characters.` }
  return { body }
}

const anchor = (n: unknown, max: number) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max
    ? Math.floor(n)
    : null

// A short quote for the bell and the email.
async function snippet(body: string) {
  const ids = mentionIds(body)
  const names = new Map(
    ids.length
      ? (
          await db
            .select({
              id: user.id,
              name: sql<string>`coalesce(nullif(${user.name}, ''), ${user.email})`,
            })
            .from(user)
            .where(inArray(user.id, ids))
        ).map((u) => [u.id, u.name])
      : []
  )
  const text = commentParts(body, (id) => names.get(id))
    .map((p) => ("mention" in p ? `@${p.name}` : "link" in p ? p.link : p.text))
    .join("")
    .replace(/\s+/g, " ")
  return text.length > 140 ? `${text.slice(0, 139)}…` : text
}

export async function addComment(
  me: Me,
  id: string,
  input: { body?: unknown; parentId?: unknown; atSeconds?: unknown; page?: unknown }
): Promise<{ error?: string; id?: string }> {
  const a = await fileAccess(me, id)
  if (!a || a.trashed) return { error: GONE }
  const b = cleanBody(input.body)
  if (b.error !== undefined) return { error: b.error }
  let root: typeof comments.$inferSelect | undefined
  if (input.parentId !== undefined && input.parentId !== null) {
    if (typeof input.parentId !== "string" || !UUID.test(input.parentId))
      return { error: "That thread isn't here anymore." }
    ;[root] = await db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.id, input.parentId),
          eq(comments.nodeId, id),
          isNull(comments.parentId)
        )
      )
    if (!root) return { error: "That thread isn't here anymore." }
  }
  const access = await peopleWithAccess(id)
  const mentions = mentionIds(b.body).filter((u) => access.has(u))
  const [row] = await db
    .insert(comments)
    .values({
      nodeId: id,
      parentId: root?.id ?? null,
      authorId: me.id,
      body: b.body,
      mentions,
      atSeconds: root ? null : anchor(input.atSeconds, 864_000),
      page: root ? null : anchor(input.page, 100_000),
    })
    .returning({ id: comments.id })
  await recordOne(id, me.id, "comment")
  changed(id)

  // Each person hears once: a mention beats a reply, a reply beats a new thread.
  const who = new Map<string, string>()
  if (root) {
    const inThread = await db
      .select({ a: comments.authorId })
      .from(comments)
      .where(
        and(
          sql`(${comments.id} = ${root.id} or ${comments.parentId} = ${root.id})`,
          isNull(comments.deletedAt)
        )
      )
    for (const r of inThread) if (r.a) who.set(r.a, "reply")
  } else who.set(a.ownerId, "thread")
  for (const m of mentions) who.set(m, "mention")
  who.delete(me.id)
  const quote = await snippet(b.body)
  for (const [userId, what] of who)
    if (access.has(userId))
      await notify(userId, "comment", {
        nodeId: id,
        actorId: me.id,
        data: { what, quote },
      })
  return { id: row.id }
}

async function own(me: Me, commentId: string) {
  if (typeof commentId !== "string" || !UUID.test(commentId)) return null
  const [c] = await db.select().from(comments).where(eq(comments.id, commentId))
  if (!c) return null
  const a = await fileAccess(me, c.nodeId)
  return a ? { c, a } : null
}

export async function editComment(me: Me, commentId: string, raw: unknown) {
  const o = await own(me, commentId)
  if (!o || o.c.deletedAt) return { error: "That comment isn't here anymore." }
  if (o.c.authorId !== me.id) return { error: "You can't edit someone else's comment." }
  if (o.a.trashed) return { error: GONE }
  const b = cleanBody(raw)
  if (b.error !== undefined) return { error: b.error }
  const access = await peopleWithAccess(o.c.nodeId)
  const mentions = mentionIds(b.body).filter((u) => access.has(u))
  await db
    .update(comments)
    .set({ body: b.body, mentions, editedAt: new Date() })
    .where(eq(comments.id, commentId))
  changed(o.c.nodeId)
  const added = mentions.filter((m) => !o.c.mentions.includes(m))
  if (added.length) {
    const quote = await snippet(b.body)
    for (const userId of added)
      await notify(userId, "comment", {
        nodeId: o.c.nodeId,
        actorId: me.id,
        data: { what: "mention", quote },
      })
  }
  return {}
}

// With replies under it, the first comment stays as a "Comment deleted" stub; the stub goes with
// its last reply.
export async function deleteComment(me: Me, commentId: string) {
  const o = await own(me, commentId)
  if (!o || o.c.deletedAt) return { error: "That comment isn't here anymore." }
  if (o.c.authorId !== me.id && !atLeast(o.a.role, "editor"))
    return { error: "You can't delete someone else's comment." }
  const [kids] = o.c.parentId
    ? [{ n: 0 }]
    : await db
        .select({ n: sql<number>`count(*)::int` })
        .from(comments)
        .where(eq(comments.parentId, o.c.id))
  if (kids.n) {
    await db
      .update(comments)
      .set({ body: null, mentions: [], deletedAt: new Date() })
      .where(eq(comments.id, o.c.id))
    await db.delete(commentReactions).where(eq(commentReactions.commentId, o.c.id))
  } else {
    await db.delete(comments).where(eq(comments.id, o.c.id))
    if (o.c.parentId)
      await db.execute(sql`
        delete from comments p where p.id = ${o.c.parentId} and p.deleted_at is not null
          and not exists (select 1 from comments r where r.parent_id = p.id)`)
  }
  changed(o.c.nodeId)
  return {}
}

// The owner, editors and whoever started the thread.
export async function resolveThread(me: Me, commentId: string, resolved: boolean) {
  const o = await own(me, commentId)
  if (!o || o.c.parentId) return { error: "That thread isn't here anymore." }
  if (o.c.authorId !== me.id && !atLeast(o.a.role, "editor"))
    return { error: "You can't resolve someone else's thread." }
  if (o.a.trashed) return { error: GONE }
  await db
    .update(comments)
    .set(
      resolved
        ? { resolvedAt: new Date(), resolvedBy: me.id }
        : { resolvedAt: null, resolvedBy: null }
    )
    .where(eq(comments.id, commentId))
  changed(o.c.nodeId)
  return {}
}

export async function react(me: Me, commentId: string, emoji: unknown, on: boolean) {
  if (!REACTIONS.includes(emoji as never)) return { error: "Pick one of the reactions." }
  const o = await own(me, commentId)
  if (!o || o.c.deletedAt) return { error: "That comment isn't here anymore." }
  if (o.a.trashed) return { error: GONE }
  const row = { commentId, userId: me.id, emoji: emoji as string }
  if (on) await db.insert(commentReactions).values(row).onConflictDoNothing()
  else
    await db
      .delete(commentReactions)
      .where(
        and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.userId, me.id),
          eq(commentReactions.emoji, row.emoji)
        )
      )
  changed(o.c.nodeId)
  return {}
}

// For the live stream's access check.
export const canSeeComments = async (me: Me, id: string) =>
  Boolean(await fileAccess(me, id))
