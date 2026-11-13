import { z } from "zod"

import { json } from "@/lib/api"
import { cliFail, cliRoute } from "@/lib/secrets/cli-api"
import { kmsRun } from "@/lib/secrets/kms-cli"

const ops = ["encrypt", "decrypt", "sign", "verify"] as const

// CONTRACT.md: POST /kms/{encrypt|decrypt|sign|verify}.
export const POST = (req: Request, ctx: { params: Promise<{ op: string }> }) =>
  cliRoute(req, async (p) => {
    const { op } = await ctx.params
    if (!ops.includes(op as (typeof ops)[number])) return cliFail(404, "not_found", "No such KMS operation.")
    const b = await json(
      req,
      z.object({
        project: z.string().max(100).optional(),
        key: z.string().max(64),
        data: z.string().max(1_500_000).optional(),
        ciphertext: z.string().max(2_000_000).optional(),
        signature: z.string().max(2000).optional(),
        context: z.string().max(1000).optional(),
      })
    )
    if (b instanceof Response) return b
    return kmsRun(p, b.project ?? null, op as (typeof ops)[number], b)
  })
