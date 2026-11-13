import { cliRoute, principalTarget, auditToken } from "@/lib/secrets/cli-api"
import { applyOps, apiSecrets, envVersion, listSecrets } from "@/lib/secrets/service"

const params = (req: Request) => {
  const u = new URL(req.url).searchParams
  return { project: u.get("project"), env: u.get("env"), path: u.get("path"), u }
}

// One folder of one environment, values included (CONTRACT.md). ETag = the environment's
// version; If-None-Match answers 304. Every 200 is audited with the token and IP.
export const GET = (req: Request) =>
  cliRoute(req, async (p) => {
    const q = params(req)
    const t = await principalTarget(p, q)
    const v = await envVersion(t.c.projectId, t.envId)
    const etag = `"${v}"`
    const headers = { etag, "x-secrets-version": String(v), "cache-control": "no-store" }
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers })
    const expand = q.u.get("expand") === "true"
    const rows = await apiSecrets(t.c, t.envId, t.folderId, { expand, own: p.type === "user" })
    await auditToken(p, "secrets_read", `${t.envSlug}${t.path ? `/${t.path}` : ""}: ${rows.length} secrets`, { projectId: t.c.projectId, env: t.envSlug })
    return Response.json(rows, { headers })
  })

// Writes, for read-write tokens and members who can edit: { project, env, path, set: {KEY: "value"}, delete: ["KEY"] }.
export const POST = (req: Request) =>
  cliRoute(req, async (p) => {
    const b = (await req.json().catch(() => null)) as {
      project?: string
      env?: string
      path?: string
      set?: Record<string, unknown>
      delete?: string[]
    } | null
    if (!b || typeof b !== "object")
      return Response.json({ error: { code: "bad_request", message: "Send a JSON body." } }, { status: 400 })
    const t = await principalTarget(p, { project: b.project ?? null, env: b.env ?? null, path: b.path ?? null }, true)
    const ops = Object.entries(b.set ?? {}).map(([key, value]) => ({ key, value: String(value) }))
    const names = new Set(b.delete ?? [])
    const deletes = (await listSecrets(t.c, t.envId, t.folderId)).filter((s) => names.has(s.key)).map((s) => s.id)
    const r = await applyOps(t.c, t.envId, t.folderId, ops, deletes, "merge")
    await auditToken(p, "secrets_write", `${r.env}: ${r.created.length} new, ${r.updated.length} changed, ${r.deleted.length} deleted${r.request ? " (sent for review)" : ""}`, { projectId: t.c.projectId, env: t.envSlug })
    // A protected environment answers 202: the change waits for approval.
    if (r.request) return Response.json({ pending: true, request: r.request.id }, { status: 202 })
    return Response.json({ created: r.created, updated: r.updated, deleted: r.deleted })
  })
