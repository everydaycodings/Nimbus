// Routes the web app and the CLI share (CONTRACT.md "Webhooks and server push"): a
// browser session goes through projectRoute; a bearer token through cliRoute, where
// {id} and {envId} may be slugs. Same role rules either way, and every call is audited.
import "server-only"

import { audit } from "@/lib/audit"
import { auditToken, cliRoute, isBearer, principalCtx } from "./cli-api"
import { projectRoute } from "./guard"
import { projectEnvs, requireEnv, type Ctx, type Role } from "./service"
import { TokenError, type Principal } from "./tokens"

export type Log = (action: string, detail?: string) => Promise<unknown>
type Params = { id: string } & Record<string, string>
type Handler<P> = (c: Ctx, req: Request, p: P, log: Log, t?: Principal) => Promise<Response>

const RANK: Record<Role, number> = { viewer: 0, developer: 1, admin: 2 }

// Machine tokens act as a Developer at most, so `need: "admin"` refuses them unless
// `machine` is set; then a read-write token with the env in scope may call it.
async function bearerCtx(t: Principal, ref: string, need: Role, machine: boolean) {
  const c = await principalCtx(t, ref)
  if (t.type === "machine") {
    if (!machine) throw new TokenError(403, "forbidden", "Machine tokens can't do this. Use a member's CLI sign-in.")
    if (t.access !== "rw") throw new TokenError(403, "forbidden", "This token is read-only.")
  } else if (RANK[c.role] < RANK[need]) throw new TokenError(403, "forbidden", "Your role in this project can't do that.")
  return c
}

export const projectApi =
  <P extends Params>(need: Role, h: Handler<P>) =>
  async (req: Request, ctx: { params: Promise<P> }) => {
    const p = await ctx.params
    if (!isBearer(req)) return projectRoute<P>(need, (c) => h(c, req, p, (a, d) => audit(a, { detail: d })))(req, ctx)
    return cliRoute(req, async (t) => {
      const c = await bearerCtx(t, p.id, need, false)
      return h(c, req, p, (a, d) => auditToken(t, a, d ?? "", { projectId: c.projectId }), t)
    })
  }

export const envApi =
  <P extends Params & { envId: string }>(need: Role, h: Handler<P>, o: { machine?: boolean } = {}) =>
  async (req: Request, ctx: { params: Promise<P> }) => {
    const p = await ctx.params
    if (!isBearer(req))
      return projectRoute<P>(need, async (c) => {
        await requireEnv(c, p.envId)
        return h(c, req, p, (a, d) => audit(a, { detail: d }))
      })(req, ctx)
    return cliRoute(req, async (t) => {
      const c = await bearerCtx(t, p.id, need, Boolean(o.machine))
      const e = (await projectEnvs(c.projectId)).find((x) => x.slug === p.envId || x.id === p.envId)
      if (!e) throw new TokenError(404, "not_found", "No such environment.")
      if (t.type === "machine" && !t.envIds.includes(e.id))
        throw new TokenError(403, "forbidden", "This token can't use that environment.")
      await requireEnv(c, e.id)
      return h(c, req, { ...p, envId: e.id }, (a, d) => auditToken(t, a, d ?? "", { projectId: c.projectId, env: e.slug }), t)
    })
  }
