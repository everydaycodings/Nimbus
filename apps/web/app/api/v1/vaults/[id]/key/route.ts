import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/vault"

// A new passphrase: the same vault key wrapped again under a new salt.
export const PUT = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({
        salt: z.string(),
        wrapped: z.string(),
        kdf: z.object({ t: z.number(), m: z.number() }),
      })
    )
    if (b instanceof Response) return b
    return done(await svc.updateVaultKey(me, (await params).id, b))
  })
