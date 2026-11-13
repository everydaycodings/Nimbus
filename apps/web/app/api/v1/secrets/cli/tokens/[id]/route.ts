import { fail } from "@/lib/api"
import { audit } from "@/lib/audit"
import { withSecrets } from "@/lib/secrets/guard"
import { revokeCliToken } from "@/lib/secrets/tokens"

export const DELETE = (_req: Request, ctx: { params: Promise<{ id: string }> }) =>
  withSecrets(async (me) => {
    const name = await revokeCliToken(me.id, (await ctx.params).id)
    if (!name) return fail(404, "not-found", "That sign-in isn't here.")
    await audit("secrets_cli_revoke", { detail: name })
    return Response.json({ ok: true })
  })
