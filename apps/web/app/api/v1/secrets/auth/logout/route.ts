import { cliRoute } from "@/lib/secrets/cli-api"
import { revokeBearer } from "@/lib/secrets/tokens"

export const POST = (req: Request) =>
  cliRoute(
    req,
    async (p) => {
      await revokeBearer(p)
      return new Response(null, { status: 204 })
    },
    { open: true }
  )
