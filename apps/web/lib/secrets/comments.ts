// A flat thread on a secret or a change request. (Phase 14's comments hang off
// file nodes, so Secrets keeps its own small table.)
import "server-only"

import { and, asc, eq } from "drizzle-orm"

import { audit } from "@/lib/audit"
import { db } from "@/lib/db"
import { secretChangeRequests, secretComments, secretReviews, secrets, user } from "@/lib/db/schema"
import { tell } from "./notices"
import { SecretsError, type Ctx } from "./service"

const bad = (m: string, status = 400) => new SecretsError(status, m)
const visible = (c: Ctx, envId: string) => !c.envs || c.envs.includes(envId)

async function target(c: Ctx, t: { secretId?: string; requestId?: string }) {
  if (t.secretId) {
    const [s] = await db.select().from(secrets).where(and(eq(secrets.id, t.secretId), eq(secrets.projectId, c.projectId)))
    if (!s || !visible(c, s.envId)) throw bad("That secret isn't here.", 404)
    return { s }
  }
  if (t.requestId) {
    const [r] = await db
      .select()
      .from(secretChangeRequests)
      .where(and(eq(secretChangeRequests.id, t.requestId), eq(secretChangeRequests.projectId, c.projectId)))
    if (!r || !visible(c, r.envId)) throw bad("That request isn't here.", 404)
    return { r }
  }
  throw bad("Say what the comment is on.")
}

export async function listComments(c: Ctx, t: { secretId?: string; requestId?: string }) {
  await target(c, t)
  const rows = await db
    .select({ id: secretComments.id, body: secretComments.body, at: secretComments.createdAt, authorId: secretComments.authorId, who: user.name })
    .from(secretComments)
    .leftJoin(user, eq(user.id, secretComments.authorId))
    .where(t.secretId ? eq(secretComments.secretId, t.secretId) : eq(secretComments.requestId, t.requestId!))
    .orderBy(asc(secretComments.createdAt))
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    at: r.at.toISOString(),
    who: r.who ?? "A former member",
    mine: r.authorId === c.userId,
  }))
}

export async function addComment(c: Ctx, t: { secretId?: string; requestId?: string }, body: string) {
  const text = body.trim().slice(0, 2000)
  if (!text) throw bad("Write something first.")
  const found = await target(c, t)
  await db.insert(secretComments).values({
    projectId: c.projectId,
    secretId: t.secretId ?? null,
    requestId: t.requestId ?? null,
    authorId: c.userId,
    body: text,
  })
  if (found.r) {
    // The author and anyone who has reviewed hear about it.
    const reviewers = await db.select({ u: secretReviews.userId }).from(secretReviews).where(eq(secretReviews.requestId, found.r.id))
    const [me] = await db.select({ n: user.name }).from(user).where(eq(user.id, c.userId))
    await tell(
      [...(found.r.authorId ? [found.r.authorId] : []), ...reviewers.map((x) => x.u)],
      c.userId,
      `${me?.n ?? "Someone"} commented on a change request: “${text.slice(0, 80)}”`,
      `/secrets/${c.projectId}?view=requests&request=${found.r.id}`
    )
  }
  await audit("secrets_comment", { detail: found.s ? `commented on ${found.s.key}` : "commented on a change request" })
}

export async function deleteComment(c: Ctx, id: string) {
  const [row] = await db.select().from(secretComments).where(and(eq(secretComments.id, id), eq(secretComments.projectId, c.projectId)))
  if (!row) throw bad("That comment isn't here.", 404)
  if (row.authorId !== c.userId && c.role !== "admin") throw bad("Only its author or an admin can delete it.", 403)
  await db.delete(secretComments).where(eq(secretComments.id, id))
}
