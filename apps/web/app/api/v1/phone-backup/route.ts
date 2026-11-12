import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/phone-backup"

// The phones that back up contacts or calendars, with the copies in each one's folder.
export const GET = () => withMember(async (me) => Response.json({ devices: await svc.listPhones(me) }))

// Phone reports its settings; makes My files / Phone backup / <deviceName> and returns its id and folder.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({ deviceName: z.string().trim().min(1).max(100), contacts: z.boolean(), calendar: z.boolean() })
    )
    if (b instanceof Response) return b
    return done(await svc.registerPhone(me, b))
  })
