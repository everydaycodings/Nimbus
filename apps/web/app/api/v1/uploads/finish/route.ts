import { z } from "zod"

import { done, json, withMember } from "@/lib/api"
import * as svc from "@/lib/services/uploads"

const Body = z
  .object({
    // The tus upload's URL (its Location header), or just its id.
    uploadUrl: z.string().optional(),
    uploadId: z.string().optional(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).nullish(),
  })
  .refine((b) => b.uploadUrl || b.uploadId, "Send uploadUrl or uploadId.")

// Step 3, after tus says the last byte landed. Idempotent; the server's tus
// hook finishes it too. Sending sha256 stores it for POST /uploads/exists and
// reports a `duplicateOf` when the same bytes are already in my files.
export const POST = (req: Request) =>
  withMember(async (me) => {
    const b = await json(req, Body)
    if (b instanceof Response) return b
    return done(
      await svc.finishUpload(me, b.uploadUrl ?? `/${b.uploadId}`, b.sha256)
    )
  })
