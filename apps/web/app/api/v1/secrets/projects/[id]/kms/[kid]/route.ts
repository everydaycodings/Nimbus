import { z } from "zod"

import { json } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { deleteKmsKey, rotateKmsKey, setKmsState } from "@/lib/secrets/kms-api"

type P = { kid: string }

export const POST = projectRoute<P>("admin", async (c, req, p) => {
  const b = await json(req, z.object({ action: z.enum(["rotate", "enable", "disable"]) }))
  if (b instanceof Response) return b
  if (b.action === "rotate") return Response.json({ version: await rotateKmsKey(c, p.kid) })
  await setKmsState(c, p.kid, b.action === "enable")
  return Response.json({})
})

export const DELETE = projectRoute<P>("admin", async (c, _r, p) => {
  await deleteKmsKey(c, p.kid)
  return Response.json({})
})
