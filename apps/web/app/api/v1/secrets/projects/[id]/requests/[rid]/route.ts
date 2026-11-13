import { z } from "zod"

import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { closeRequest, mergeRequest, requestDetail, revealChange, reviewRequest } from "@/lib/secrets/requests"

type P = { rid: string }

export const GET = projectRoute<P>("viewer", async (c, _, p) => Response.json(await requestDetail(c, p.rid)))

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("merge") }),
  z.object({ action: z.literal("close") }),
  // One change's old and new value, for the diff. Logged.
  z.object({ action: z.literal("reveal"), index: z.number().int().min(0).max(5000) }),
])

export const POST = projectRoute<P>("viewer", async (c, req, p) => {
  const b = await json(req, body)
  if (b instanceof Response) return b
  switch (b.action) {
    case "approve":
    case "reject":
      return Response.json({ state: await reviewRequest(c, p.rid, b.action) })
    case "merge":
      await mergeRequest(c, p.rid)
      return Response.json({ ok: true })
    case "close":
      await closeRequest(c, p.rid)
      return Response.json({ ok: true })
    case "reveal": {
      const r = await revealChange(c, p.rid, b.index)
      await audit("secrets_reveal", { detail: `${r.key} (change request)` })
      return Response.json(r)
    }
  }
})
