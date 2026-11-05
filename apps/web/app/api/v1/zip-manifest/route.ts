import { z } from "zod"

import { json, uuid, withMember } from "@/lib/api"
import * as svc from "@/lib/services/uploads"

// Presigned URLs for everything under `ids`, for building a zip on the phone.
// (POST /api/zip streams a finished zip instead.)
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, z.object({ ids: z.array(uuid).min(1).max(1000) }))
    if (b instanceof Response) return b
    return Response.json(await svc.zipManifest(me, b.ids))
  })
