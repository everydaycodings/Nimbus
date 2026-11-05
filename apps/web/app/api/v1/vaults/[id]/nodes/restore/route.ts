import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/vault"

// Restores from the vault's trash. Items whose name is taken stay in the trash; { kept } counts them.
export const POST = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ ids: z.array(z.string()).min(1).max(1000) }))
    if (b instanceof Response) return b
    return done(await svc.restoreVaultNodes(me, (await params).id, b.ids))
  })
