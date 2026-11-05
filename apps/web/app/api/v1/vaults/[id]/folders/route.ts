import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/vault"

// Folders in order, parents first. `parent` is an existing folder id, null for
// the vault root, or the `key` of an earlier folder in the same call. All or
// nothing. Returns { ids: { [key]: folderId } }.
export const POST = (
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({
        folders: z
          .array(
            z.object({
              key: z.string(),
              parent: z.string().nullable(),
              name: z.string(),
              tag: z.string(),
            })
          )
          .max(10_000),
      })
    )
    if (b instanceof Response) return b
    return done(await svc.createVaultFolders(me, (await params).id, b.folders))
  })
