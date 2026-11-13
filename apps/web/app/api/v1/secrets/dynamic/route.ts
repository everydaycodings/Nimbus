import { z } from "zod"

import { json } from "@/lib/api"
import { auditAs } from "@/lib/audit"
import { actorOf, cliRoute, principalCtx } from "@/lib/secrets/cli-api"
import { generate, listConnections, renewLease, revokeLease, type Log } from "@/lib/secrets/dynamic"
import { TokenError, type Principal } from "@/lib/secrets/tokens"
import type { Ctx } from "@/lib/secrets/service"

// CONTRACT.md "Dynamic database credentials". A member's CLI token (Developer or Admin) or a
// read-write machine token; read-only tokens and Viewers get 403.
async function scope(p: Principal, project: string | null) {
  const c = await principalCtx(p, project)
  if (c.role === "viewer") throw new TokenError(403, "forbidden", p.type === "machine" ? "This token is read-only." : "Your role in this project can't issue database credentials.")
  const log: Log = (action, detail) =>
    auditAs(actorOf(p), action, `${detail} (${p.type === "machine" ? "machine token" : "CLI"}, ${p.ip ?? "?"})`, { projectId: c.projectId, ip: p.ip })
  return { c, log }
}

const connectionOf = async (c: Ctx, ref: string) => {
  const found = (await listConnections(c)).find((x) => x.name === ref || x.id === ref)
  if (!found) throw new TokenError(404, "not_found", `No connection called “${ref}”.`)
  return found
}

const noStore = { "cache-control": "no-store" }

export const GET = (req: Request) =>
  cliRoute(req, async (p) => {
    const { c } = await scope(p, new URL(req.url).searchParams.get("project"))
    const connections = (await listConnections(c)).map((x) => ({ id: x.id, name: x.name, engine: x.engine, defaultTtl: x.defaultTtl, maxTtl: x.maxTtl }))
    return Response.json({ connections })
  })

export const POST = (req: Request) =>
  cliRoute(req, async (p) => {
    const b = await json(req, z.object({ project: z.string().max(100).optional(), connection: z.string().max(100), ttl: z.union([z.string().max(10), z.number()]).optional() }))
    if (b instanceof Response) return b
    const { c, log } = await scope(p, b.project ?? null)
    const conn = await connectionOf(c, b.connection)
    const r = await generate(c, conn.id, b.ttl, actorOf(p).name, log)
    return Response.json({ ...r, leaseId: r.lease.id, expiresAt: r.lease.expiresAt }, { headers: noStore })
  })

// Renew: PATCH { project?, lease, ttl? }
export const PATCH = (req: Request) =>
  cliRoute(req, async (p) => {
    const b = await json(req, z.object({ project: z.string().max(100).optional(), lease: z.string().max(40), ttl: z.union([z.string().max(10), z.number()]).optional() }))
    if (b instanceof Response) return b
    const { c, log } = await scope(p, b.project ?? null)
    const l = await renewLease(c, b.lease, b.ttl, log)
    return Response.json({ leaseId: l.id, expiresAt: l.expiresAt }, { headers: noStore })
  })

// Revoke: DELETE ?project=&lease=
export const DELETE = (req: Request) =>
  cliRoute(req, async (p) => {
    const q = new URL(req.url).searchParams
    const { c, log } = await scope(p, q.get("project"))
    await revokeLease(c, q.get("lease") ?? "", log)
    return Response.json({})
  })
