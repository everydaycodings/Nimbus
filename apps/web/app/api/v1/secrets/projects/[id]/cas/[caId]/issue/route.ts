import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { issueFromCa } from "@/lib/secrets/pki"

// Issues from a CSR (its key stays with the caller) or makes the key here. Lands in the store.
export const POST = projectRoute<{ caId: string }>("developer", async (c, req, p) => {
  const b = await json(req, z.object({ templateId: uuid, name: z.string().max(80).default(""), cn: z.string().max(100).default(""), sans: z.array(z.string().max(200)).max(50).default([]), ttlDays: z.number().int().min(1).max(3650), csr: z.string().max(20_000).optional(), keyKind: z.enum(["ec", "rsa"]).default("ec") }))
  if (b instanceof Response) return b
  return Response.json(await issueFromCa(c, uuid.parse(p.caId), b))
})
