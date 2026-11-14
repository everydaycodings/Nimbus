import { z } from "zod"

import { json, query, uuid } from "@/lib/api"
import { auditScope } from "@/lib/secrets/audit-ctx"
import { auditToken, cliRoute, isBearer, serverUrl } from "@/lib/secrets/cli-api"
import { withSecrets } from "@/lib/secrets/guard"
import { createShare, listShares, revokeShare } from "@/lib/secrets/shares"
import { SecretsError, policy, projectCtx, readValues } from "@/lib/secrets/service"
import { TokenError, type Principal } from "@/lib/secrets/tokens"

type Member = Extract<Principal, { type: "user" }>
type Log = (action: string, detail: string) => Promise<unknown>

// With a bearer token (CONTRACT.md "Share links"): a member's CLI sign-in only. A link
// belongs to the member who made it ("Shared by me"); a machine token has no member.
const asMember = (req: Request, fn: (t: Member, log: Log) => Promise<Response>) =>
  cliRoute(req, (t) => {
    if (t.type !== "user") throw new TokenError(403, "forbidden", "Share links need a member's CLI sign-in, not a machine token.")
    return fn(t, (a, d) => auditToken(t, a, d))
  })

// The links this member made ("Shared by me").
export const GET = (req: Request) =>
  isBearer(req)
    ? asMember(req, async (t, log) => {
        await log("secrets_share_list", "")
        return Response.json({ shares: await listShares(t.userId), enabled: (await policy()).sharesEnabled })
      })
    : withSecrets(async (me) =>
    Response.json({ shares: await listShares(me.id), enabled: (await policy()).sharesEnabled })
  )

const body = z.object({
  // Either some text, or a secret of a project (its value is read here, never sent to the browser).
  text: z.string().max(100_000).optional(),
  projectId: uuid.optional(),
  secretId: uuid.optional(),
  minutes: z.number().int(),
  maxViews: z.number().int(),
  password: z.string().max(200).optional(),
  label: z.string().max(80).optional(),
})

export const POST = (req: Request) =>
  isBearer(req)
    ? asMember(req, async (t, log) => {
        const b = await json(req, body.pick({ text: true, minutes: true, maxViews: true, password: true, label: true }))
        if (b instanceof Response) return b
        const token = await createShare(t.userId, { ...b, text: b.text ?? "" }, log)
        return Response.json({ token, url: `${serverUrl(req)}/s/${token}` })
      })
    : withSecrets(async (me) => {
    const b = await json(req, body)
    if (b instanceof Response) return b
    let text = b.text ?? ""
    let label = b.label
    const make = async () => createShare(me.id, { text, minutes: b.minutes, maxViews: b.maxViews, password: b.password, label })
    if (b.projectId && b.secretId) {
      const c = await projectCtx(me.id, b.projectId)
      if (!c) throw new SecretsError(404, "That project isn't here.")
      const [v] = await readValues(c, [b.secretId])
      if (!v) throw new SecretsError(404, "That secret isn't here.")
      text = v.value
      label ??= v.key
      const token = await auditScope.run({ projectId: b.projectId }, make)
      return Response.json({ token })
    }
    return Response.json({ token: await make() })
  })

export const DELETE = (req: Request) =>
  isBearer(req)
    ? asMember(req, async (t, log) => {
        const q = query(req, z.object({ id: uuid }))
        if (q instanceof Response) return q
        await revokeShare(t.userId, q.id, log)
        return Response.json({ ok: true })
      })
    : withSecrets(async (me) => {
    const q = query(req, z.object({ id: uuid }))
    if (q instanceof Response) return q
    await revokeShare(me.id, q.id)
    return Response.json({ ok: true })
  })
