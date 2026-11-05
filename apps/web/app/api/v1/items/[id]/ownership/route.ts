import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/shares"

type Ctx = { params: Promise<{ id: string }> }

// Offers ownership to another active member. Nothing moves until they accept.
export const POST = (req: Request, { params }: Ctx) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ to: z.string().min(1) }))
    if (b instanceof Response) return b
    return done(await svc.offerOwnership(me, (await params).id, b.to))
  })

// Withdraws my offer.
export const DELETE = (_: Request, { params }: Ctx) =>
  withMember(async (me) =>
    done(await svc.cancelOwnershipOffer(me, (await params).id))
  )
