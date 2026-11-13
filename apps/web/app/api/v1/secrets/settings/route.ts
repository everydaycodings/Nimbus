import { z } from "zod"

import { fail, json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { withSecrets } from "@/lib/secrets/guard"
import { setLockMinutes, setPin } from "@/lib/secrets/unlock"

// Auto-lock minutes, and the Secrets PIN (a string sets it, null removes it).
export const PUT = (req: Request) =>
  withSecrets(
    async () => {
      const b = await json(
        req,
        z.object({
          lockMinutes: z.number().optional(),
          pin: z.string().max(100).nullable().optional(),
        })
      )
      if (b instanceof Response) return b
      if (b.pin !== undefined) {
        const error = await setPin(b.pin)
        if (error) return fail(400, "refused", error)
        await audit(b.pin === null ? "secrets_pin_removed" : "secrets_pin_set")
      }
      if (b.lockMinutes !== undefined) await setLockMinutes(b.lockMinutes)
      return Response.json({ ok: true })
    },
    { open: true }
  )
