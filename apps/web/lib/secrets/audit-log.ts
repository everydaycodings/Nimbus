// The project's Audit tab: every secrets_* event written inside it.
import "server-only"

import { and, desc, eq, gte, like, lt, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { auditEvents } from "@/lib/db/schema"
import type { Ctx } from "./service"

export type AuditQuery = { actor?: string; action?: string; env?: string; from?: string; to?: string; before?: string }

export async function projectAudit(c: Ctx, q: AuditQuery) {
  const day = (s: string, end = false) => {
    const d = new Date(`${s}T00:00:00Z`)
    return isNaN(+d) ? undefined : new Date(d.getTime() + (end ? 86_400_000 : 0))
  }
  const from = q.from ? day(q.from) : undefined
  const to = q.to ? day(q.to, true) : undefined
  const before = q.before ? new Date(q.before) : undefined
  const where = and(
    eq(auditEvents.projectId, c.projectId),
    like(auditEvents.action, "secrets\\_%"),
    q.actor ? eq(auditEvents.actorId, q.actor) : undefined,
    q.action ? eq(auditEvents.action, q.action) : undefined,
    q.env ? eq(auditEvents.env, q.env) : undefined,
    from ? gte(auditEvents.at, from) : undefined,
    to ? lt(auditEvents.at, to) : undefined,
    before && !isNaN(+before) ? lt(auditEvents.at, before) : undefined
  )
  const rows = await db.select().from(auditEvents).where(where).orderBy(desc(auditEvents.at)).limit(101)
  const [facets] = await db.execute<{ actors: { id: string; name: string }[]; actions: string[]; envs: string[] }>(sql`
    select
      coalesce((select json_agg(distinct jsonb_build_object('id', actor_id, 'name', actor_name)) from audit_events where project_id = ${c.projectId} and actor_id is not null), '[]'::json) as actors,
      coalesce((select json_agg(distinct action) from audit_events where project_id = ${c.projectId} and action like 'secrets\\_%'), '[]'::json) as actions,
      coalesce((select json_agg(distinct env) from audit_events where project_id = ${c.projectId} and env is not null), '[]'::json) as envs`)
  return {
    rows: rows.slice(0, 100).map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      actor: r.actorName,
      action: r.action,
      detail: r.detail,
      target: r.targetName,
      env: r.env,
      ip: r.ip,
      device: r.device,
    })),
    more: rows.length > 100,
    facets,
  }
}
