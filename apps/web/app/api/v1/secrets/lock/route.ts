import { withSecrets } from "@/lib/secrets/guard"
import { lock } from "@/lib/secrets/unlock"

export const POST = () =>
  withSecrets(
    async () => {
      await lock()
      return Response.json({ ok: true })
    },
    { open: true }
  )
