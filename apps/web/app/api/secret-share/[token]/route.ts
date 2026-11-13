import { z } from "zod"

import { fail, json, limitIp } from "@/lib/api"
import { overLimit } from "@/lib/cache"
import { revealShare, shareMeta } from "@/lib/secrets/shares"

// Public: no sign-in. GET says whether the link works (it doesn't count as a view);
// POST opens it and burns a view. Rate limited per visitor and per link.
export const GET = async (_: Request, ctx: { params: Promise<{ token: string }> }) => {
  const limited = await limitIp("secret-share")
  if (limited) return limited
  return Response.json(await shareMeta((await ctx.params).token), { headers: { "cache-control": "no-store" } })
}

export const POST = async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const limited = await limitIp("secret-share")
  if (limited) return limited
  const { token } = await ctx.params
  if (await overLimit(`rl:secret-share:${token.slice(0, 20)}`, 20, 60))
    return fail(429, "rate_limited", "Too many tries. Wait a minute.")
  const b = await json(req, z.object({ password: z.string().max(200).default("") }))
  if (b instanceof Response) return b
  const r = await revealShare(token, b.password)
  return Response.json(r, { status: r.ok ? 200 : r.error === "password" ? 403 : 410, headers: { "cache-control": "no-store" } })
}
