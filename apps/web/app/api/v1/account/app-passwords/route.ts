import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/account"

// Makes an app password (for WebDAV). The password is in the answer once and never again.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ name: z.string(), scope: z.enum(["rw", "ro"]) }))
    if (b instanceof Response) return b
    return done(await svc.createAppPassword(me, b.name, b.scope))
  })
