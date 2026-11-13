import { z } from "zod"

import { fail, json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { withSecrets } from "@/lib/secrets/guard"
import { unlockWith } from "@/lib/secrets/unlock"

export const POST = (req: Request) =>
  withSecrets(
    async () => {
      const b = await json(
        req,
        z.object({
          method: z.enum(["password", "passkey", "totp", "pin"]),
          value: z.unknown(),
        })
      )
      if (b instanceof Response) return b
      const error = await unlockWith(b.method, b.value)
      if (error) {
        await audit("secrets_unlock_failed", { detail: b.method })
        return fail(401, "unlock-failed", error)
      }
      await audit("secrets_unlock", { detail: b.method })
      return Response.json({ ok: true })
    },
    { open: true }
  )
