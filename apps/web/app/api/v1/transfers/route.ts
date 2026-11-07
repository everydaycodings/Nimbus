import { z } from "zod"

import { done, json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/transfers"

// My sent transfers, newest first, and what the admin allows.
export const GET = () =>
  withMember(async (me) =>
    Response.json({
      transfers: await svc.listTransfers(me),
      options: await svc.transferOptions(),
    })
  )

// Starts a transfer as a draft, copying the Nimbus items in `nodeIds`. Add
// device files with POST /transfers/{id}/files, then POST /transfers/{id}/finalise.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({
        nodeIds: z.array(uuid).max(1000),
        title: z.string().optional(),
        message: z.string().optional(),
        days: z.number().int(),
        password: z.string().optional(),
        downloadLimit: z.number().int().nullish(),
        emails: z.array(z.string()).max(50).optional(),
        link: z.boolean().optional(),
      })
    )
    if (b instanceof Response) return b
    return done(await svc.createTransfer(me, b))
  })
