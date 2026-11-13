import { z } from "zod"

import { fail, json } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { renewLease, revealLease, revokeLease, sessionLog } from "@/lib/secrets/dynamic"

type P = { lid: string }
const noViewer = async <T,>(role: string, fn: () => Promise<T>) =>
  role === "viewer" ? fail(403, "forbidden", "Your role in this project can't do that.") : Response.json(await fn())

// GET shows the password again (audited) while the lease runs.
export const GET = projectRoute<P>("developer", (c, _req, p) => noViewer(c.role, () => revealLease(c, p.lid, sessionLog)))

export const PATCH = projectRoute<P>("developer", async (c, req, p) => {
  const b = await json(req, z.object({ ttl: z.union([z.string().max(10), z.number()]).optional() }))
  if (b instanceof Response) return b
  return noViewer(c.role, () => renewLease(c, p.lid, b.ttl, sessionLog))
})

export const DELETE = projectRoute<P>("developer", (c, _req, p) => noViewer(c.role, async () => (await revokeLease(c, p.lid, sessionLog), {})))
