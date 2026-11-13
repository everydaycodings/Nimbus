import { fail } from "@/lib/api"
import { withSecrets } from "@/lib/secrets/guard"
import { passkeyOptions } from "@/lib/secrets/unlock"

// WebAuthn options for unlocking with a passkey.
export const POST = () =>
  withSecrets(
    async () => {
      const options = await passkeyOptions()
      return options ? Response.json(options) : fail(400, "no-passkey", "No passkey is available.")
    },
    { open: true }
  )
