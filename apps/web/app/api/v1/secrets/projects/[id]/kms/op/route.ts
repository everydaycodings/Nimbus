import { z } from "zod"

import { fail, json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { kmsOperation } from "@/lib/secrets/kms-api"

// The Try-it panel. Viewers may verify; developers and admins may run all four.
export const POST = projectRoute("viewer", async (c, req) => {
  const b = await json(
    req,
    z.object({
      op: z.enum(["encrypt", "decrypt", "sign", "verify"]),
      key: z.string().max(64),
      data: z.string().max(1_500_000).optional(),
      ciphertext: z.string().max(2_000_000).optional(),
      signature: z.string().max(2000).optional(),
      context: z.string().max(1000).optional(),
    })
  )
  if (b instanceof Response) return b
  if (b.op !== "verify" && c.role === "viewer") return fail(403, "forbidden", "Viewers can verify, not encrypt, decrypt or sign.")
  const r = await kmsOperation(c, b.op, b)
  await audit(`secrets_kms_${b.op}`, { detail: r.detail })
  return Response.json(r.out)
})
