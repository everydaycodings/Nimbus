import { z } from "zod"

import { fail, query } from "@/lib/api"
import { withSecrets } from "@/lib/secrets/guard"
import { lookupDevice } from "@/lib/secrets/tokens"

// What the approve page shows for a code: the device, its IP and whether it's still waiting.
export const GET = (req: Request) =>
  withSecrets(async () => {
    const q = query(req, z.object({ code: z.string().max(20) }))
    if (q instanceof Response) return q
    const r = await lookupDevice(q.code)
    return r ? Response.json(r) : fail(404, "not-found", "That code isn't valid.")
  })
