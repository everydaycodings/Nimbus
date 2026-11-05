import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/vault"

// Gives older items their name tag (the app computes it when the vault opens).
export const POST = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({ tags: z.array(z.object({ id: z.string(), tag: z.string() })).max(10_000) })
    )
    if (b instanceof Response) return b
    return done(await svc.setVaultTags(me, (await params).id, b.tags))
  })
