import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { addCa, listCas } from "@/lib/secrets/pki"

export const GET = projectRoute("viewer", async (c) => Response.json({ cas: await listCas(c) }))

export const POST = projectRoute("admin", async (c, req) => {
  const b = await json(req, z.object({ name: z.string().max(80), cn: z.string().max(100), years: z.number().int().min(1).max(30), keyKind: z.enum(["ec", "rsa"]).default("ec"), parentId: uuid.nullable().default(null) }))
  if (b instanceof Response) return b
  return Response.json({ id: await addCa(c, b) })
})
