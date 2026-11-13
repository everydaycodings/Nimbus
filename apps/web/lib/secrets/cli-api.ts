// The CLI/REST side of /api/v1/secrets (packages/cli/CONTRACT.md): bearer tokens,
// errors shaped { error: { code, message } }, user tokens subject to the unlock.
import "server-only"

import { auditAs } from "@/lib/audit"
import { kmsConfigured } from "./kms"
import {
  SecretsError,
  envSlugAndFolder,
  memberProjectId,
  policy,
  projectCtx,
  projectEnvs,
  systemCtx,
  type Ctx,
} from "./service"
import { pathInScope } from "./token-rules"
import {
  TokenError,
  authenticate,
  tokenPolicy,
  userUnlocked,
  type Principal,
} from "./tokens"
import { db } from "@/lib/db"
import { secretProjects } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export const isBearer = (req: Request) => /^Bearer\s/i.test(req.headers.get("authorization") ?? "")

export const serverUrl = (req: Request) =>
  (process.env.BETTER_AUTH_URL ?? new URL(req.url).origin).replace(/\/+$/, "")

export function cliFail(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers?: HeadersInit) {
  return Response.json({ error: { code, message }, ...extra }, { status, headers })
}

const CODE: Record<number, string> = { 400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 422: "bad_request", 423: "locked", 429: "rate_limited" }

export async function cliGuard(req: Request, fn: () => Promise<Response>) {
  try {
    if (!(await policy()).enabled) return cliFail(404, "not_found", "An admin turned Secrets off on this server.")
    if (!kmsConfigured()) return cliFail(503, "server_error", "SECRETS_ROOT_KEY isn't set on this server.")
    return await fn()
  } catch (e) {
    if (e instanceof TokenError)
      return cliFail(e.status, e.code, e.message, e.extra, e.status === 429 ? { "retry-after": "60" } : undefined)
    if (e instanceof SecretsError) return cliFail(e.status, CODE[e.status] ?? "server_error", e.message)
    throw e
  }
}

// A request made with a bearer token: authenticated, and for a member's token, unlocked.
export const cliRoute = (
  req: Request,
  fn: (p: Principal) => Promise<Response>,
  opts: { open?: boolean } = {}
) =>
  cliGuard(req, async () => {
    const p = await authenticate(req)
    if (p.type === "user" && !opts.open && !(await userUnlocked(p.userId)))
      return cliFail(423, "locked", "Secrets are locked. Unlock them in the web app.", {
        unlockUrl: `${serverUrl(req)}/secrets`,
      })
    return fn(p)
  })

// The project this caller means. Machine tokens have exactly one.
export async function principalCtx(p: Principal, ref: string | null): Promise<Ctx> {
  if (p.type === "machine") {
    const [proj] = await db.select().from(secretProjects).where(eq(secretProjects.id, p.projectId))
    if (ref && ref !== proj?.slug && ref !== proj?.id)
      throw new TokenError(403, "forbidden", "This token belongs to a different project.")
    const c = await systemCtx(p.projectId)
    if (!c) throw new TokenError(404, "not_found", "That project is gone.")
    return { ...c, role: p.access === "rw" ? "developer" : "viewer", envs: p.envIds, actor: { id: null, name: `token: ${p.name}` } }
  }
  if (!ref) throw new TokenError(400, "bad_request", "Say which project (project=…).")
  const id = await memberProjectId(p.userId, ref)
  const c = id && (await projectCtx(p.userId, id))
  if (!c) throw new TokenError(404, "not_found", "No such project.")
  return c
}

// Project + env + folder from the query. A machine token may leave out the env when it has one.
export async function principalTarget(
  p: Principal,
  q: { project: string | null; env: string | null; path: string | null },
  write = false
) {
  const c = await principalCtx(p, q.project)
  const path = (q.path ?? "/").split("/").filter(Boolean).join("/")
  let envSlug = q.env
  if (!envSlug && p.type === "machine" && p.envIds.length === 1)
    envSlug = (await projectEnvs(c.projectId)).find((e) => e.id === p.envIds[0])?.slug ?? null
  if (!envSlug) throw new TokenError(400, "bad_request", "Say which environment (env=…).")
  if (p.type === "machine") {
    const e = (await projectEnvs(c.projectId)).find((x) => x.slug === envSlug)
    if (e && !p.envIds.includes(e.id))
      throw new TokenError(403, "forbidden", "This token can't use that environment.")
    if (!pathInScope(p.path, path))
      throw new TokenError(403, "forbidden", "This token can't use that folder.")
    if (write && p.access !== "rw") throw new TokenError(403, "forbidden", "This token is read-only.")
  } else if (write && c.role === "viewer")
    throw new TokenError(403, "forbidden", "Your role in this project can't change secrets.")
  const at = await envSlugAndFolder(c, envSlug, path)
  return { c, envSlug, path, ...at }
}

export const actorOf = (p: Principal) =>
  p.type === "machine" ? { id: null, name: `token: ${p.name}` } : { id: p.userId, name: p.name || p.email }

export const auditToken = (
  p: Principal,
  action: string,
  detail: string,
  at?: { projectId: string; env: string }
) =>
  auditAs(actorOf(p), action, `${detail} (${p.type === "machine" ? "machine token" : "CLI"}, ${p.ip ?? "?"})`, {
    ...at,
    ip: p.ip ?? "?",
  })

export { tokenPolicy }
