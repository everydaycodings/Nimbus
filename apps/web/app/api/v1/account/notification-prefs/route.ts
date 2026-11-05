import { z } from "zod"

import { json, withMember } from "@/lib/api"
import { NOTIFICATION_KINDS } from "@/lib/db/schema"
import * as svc from "@/lib/services/account"

// Sets bell and email per kind. Kinds you leave out keep their setting.
export const PUT = (req: Request) =>
  withMember(async (me) => {
    const b = await json(
      req,
      z.object({
        prefs: z.partialRecord(
          z.enum(NOTIFICATION_KINDS),
          z.object({ email: z.boolean(), bell: z.boolean() })
        ),
      })
    )
    if (b instanceof Response) return b
    await svc.setNotificationPrefs(me, b.prefs)
    return Response.json({})
  })
