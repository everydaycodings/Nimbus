import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { certDetail, deleteCert, renameCert, setAutoRenew } from "@/lib/secrets/pki"

type P = { certId: string }

export const GET = projectRoute<P>("viewer", async (c, _r, p) => Response.json(await certDetail(c, uuid.parse(p.certId))))

export const PATCH = projectRoute<P>("developer", async (c, req, p) => {
  const b = await json(req, z.object({ name: z.string().max(80).optional(), autoRenew: z.boolean().optional() }))
  if (b instanceof Response) return b
  const id = uuid.parse(p.certId)
  if (b.name !== undefined) await renameCert(c, id, b.name)
  if (b.autoRenew !== undefined) await setAutoRenew(c, id, b.autoRenew)
  return Response.json({})
})

export const DELETE = projectRoute<P>("developer", async (c, _r, p) => {
  await deleteCert(c, uuid.parse(p.certId))
  return Response.json({})
})
