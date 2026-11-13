import { z } from "zod"

import { fail, json } from "@/lib/api"
import { connSchema } from "@/lib/secrets/dyn-schemas"
import { projectRoute } from "@/lib/secrets/guard"
import { deleteConnection, generate, sessionLog, testConnection, updateConnection } from "@/lib/secrets/dynamic"
import { getSession } from "@/lib/session"

type P = { cid: string }

export const PATCH = projectRoute<P>("admin", async (c, req, p) => {
  const b = await json(req, connSchema)
  if (b instanceof Response) return b
  return Response.json(await updateConnection(c, p.cid, b, sessionLog))
})

export const DELETE = projectRoute<P>("admin", async (c, _req, p) => {
  await deleteConnection(c, p.cid, sessionLog)
  return Response.json({})
})

// test: admins; generate: developers and admins (a viewer can't, even with a grant).
export const POST = projectRoute<P>("developer", async (c, req, p) => {
  const b = await json(req, z.object({ action: z.enum(["test", "generate"]), ttl: z.union([z.string().max(10), z.number()]).optional() }))
  if (b instanceof Response) return b
  if (c.role === "viewer") return fail(403, "forbidden", "Your role in this project can't do that.")
  if (b.action === "test") {
    if (c.role !== "admin") return fail(403, "forbidden", "Only project admins can test a connection.")
    return Response.json(await testConnection(c, p.cid, sessionLog))
  }
  const name = (await getSession())?.user
  return Response.json(await generate(c, p.cid, b.ttl, name?.name || name?.email || "a member", sessionLog))
})
