import { audit } from "@/lib/audit"
import { fail } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { revokeMachineToken } from "@/lib/secrets/tokens"

export const DELETE = projectRoute<{ tokenId: string }>("admin", async (c, _req, p) => {
  const name = await revokeMachineToken(c.projectId, p.tokenId)
  if (!name) return fail(404, "not-found", "That token isn't here or is already revoked.")
  await audit("secrets_token_revoke", { detail: name })
  return Response.json({ ok: true })
})
