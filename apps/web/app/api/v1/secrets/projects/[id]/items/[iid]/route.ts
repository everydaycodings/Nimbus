import { z } from "zod"

import { json, query, uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { deleteItem, revealItem, updateItem } from "@/lib/secrets/items"

type P = { iid: string }

// Opening an item shows its values and is logged (?copy=1 logs it as a copy).
export const GET = projectRoute<P>("developer", async (c, req, p) => {
  const q = query(req, z.object({ copy: z.string().optional() }))
  if (q instanceof Response) return q
  return Response.json(await revealItem(c, uuid.parse(p.iid), q.copy ? "copy" : "view"))
})

export const PATCH = projectRoute<P>("developer", async (c, req, p) => {
  const b = await json(req, z.object({ name: z.string().max(80).optional(), data: z.record(z.string(), z.unknown()).optional(), expiresAt: z.string().max(40).nullable().optional() }))
  if (b instanceof Response) return b
  await updateItem(c, uuid.parse(p.iid), b)
  return Response.json({})
})

export const DELETE = projectRoute<P>("developer", async (c, _r, p) => {
  await deleteItem(c, uuid.parse(p.iid))
  return Response.json({})
})
