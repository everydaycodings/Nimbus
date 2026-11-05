import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/vault"

// Renames: the new sealed name and its name tag.
export const PATCH = (
  req: Request,
  { params }: { params: Promise<{ id: string; nodeId: string }> }
) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ name: z.string(), tag: z.string() }))
    if (b instanceof Response) return b
    const { id, nodeId } = await params
    return done(await svc.renameVaultNode(me, id, nodeId, b.name, b.tag))
  })
