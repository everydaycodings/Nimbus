import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/vault"

// One tus token per target folder, for files of these plaintext sizes. Space
// and the upload limit are checked on the encrypted sizes. Returns { tokens }
// in the order of `groups`.
export const POST = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({
        groups: z
          .array(z.object({ parentId: uuid.nullable(), sizes: z.array(z.number().int().min(0)) }))
          .max(10_000),
      })
    )
    if (b instanceof Response) return b
    return done(await svc.planVaultUpload(me, (await params).id, b.groups))
  })
