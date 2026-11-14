// Route guard for /api/v1/secrets: signed in, Secrets on, root key set, and (for
// everything but the unlock routes) an unlocked session, which this call slides
// forward. 423 means "locked": the web shows the unlock screen.
import "server-only"

import { fail, withMember } from "@/lib/api"
import type { Me } from "@/lib/session"
import { kmsConfigured } from "./kms"
import { auditScope } from "./audit-ctx"
import { policy, projectCtx, SecretsError, type Ctx, type Role } from "./service"
import { unlockState } from "./unlock"

const RANK: Record<Role, number> = { viewer: 0, developer: 1, admin: 2 }

type Opts = { open?: boolean } // open: skip the unlock check (status, unlock, lock)

async function run(fn: () => Promise<Response>) {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof SecretsError)
      return Response.json(
        { error: "refused", message: e.message, fields: e.fields },
        { status: e.status }
      )
    throw e
  }
}

export const withSecrets = (fn: (me: Me) => Promise<Response>, o: Opts = {}) =>
  withMember((me) =>
    run(async () => {
      const pol = await policy()
      if (!pol.enabled) return fail(404, "disabled", "An admin turned Secrets off on this server.")
      if (pol.require2fa && !me.twoFactorEnabled)
        return fail(403, "needs-2fa", "This server requires two-factor sign-in for Secrets. Turn it on under Account.")
      if (!kmsConfigured())
        return fail(503, "no-root-key", "SECRETS_ROOT_KEY isn't set on this server.")
      if (!o.open) {
        const st = await unlockState()
        if (!st?.unlocked) return fail(423, "locked", "Unlock Secrets first.")
      }
      return fn(me)
    })
  )

// A project the member belongs to, with at least the role `need`. `grant`: the route
// only writes secrets through the service's per-environment checks, so a temporary
// developer grant on some environment may open it. Project-wide routes (items, PKI,
// leases…) leave it off, or a grant on one environment would act as Developer there.
export const withProject = (
  projectId: string,
  need: Role,
  fn: (c: Ctx, me: Me) => Promise<Response>,
  grant = false
) =>
  withSecrets(async (me) => {
    const c = await projectCtx(me.id, projectId)
    if (!c) return fail(404, "not-found", "That project isn't here, or you can't open it.")
    const granted = grant && need === "developer" && Boolean(c.writeEnvs?.length)
    if (RANK[c.role] < RANK[need] && !granted)
      return fail(403, "forbidden", "Your role in this project can't do that.")
    return auditScope.run({ projectId }, () => fn(c, me))
  })

// A route handler for /projects/[id]/…: `p` holds the path params.
export const projectRoute =
  <P extends Record<string, string> = Record<never, string>>(
    need: Role,
    h: (c: Ctx, req: Request, p: P & { id: string }) => Promise<Response>,
    o: { grant?: boolean } = {}
  ) =>
  async (req: Request, ctx: { params: Promise<P & { id: string }> }) => {
    const p = await ctx.params
    return withProject(p.id, need, (c) => h(c, req, p), o.grant)
  }
