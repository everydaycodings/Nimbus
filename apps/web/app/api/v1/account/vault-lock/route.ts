import { z } from "zod"

import { json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/account"

// How long an unlocked vault stays open idle: 5, 15, 30 or 60 minutes.
export const PUT = (req: Request) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({
        minutes: z.number().refine((m) => svc.VAULT_LOCK_MINUTES.includes(m), "Pick 5, 15, 30 or 60."),
      })
    )
    if (b instanceof Response) return b
    await svc.setVaultLock(me, b.minutes)
    return Response.json({})
  })
