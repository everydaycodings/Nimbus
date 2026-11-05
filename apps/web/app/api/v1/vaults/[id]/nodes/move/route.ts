import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/vault"

// Moves items to a folder of the vault (parentId null: its root).
export const POST = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ ids: z.array(z.string()).min(1).max(1000), parentId: z.string().nullable() }))
    if (b instanceof Response) return b
    return done(await svc.moveVaultNodes(me, (await params).id, b.ids, b.parentId))
  })
