import { withSecrets } from "@/lib/secrets/guard"
import { listCliTokens } from "@/lib/secrets/tokens"

// The CLI sign-ins of the signed-in member.
export const GET = () =>
  withSecrets(async (me) => Response.json({ tokens: await listCliTokens(me.id) }))
