import { z } from "zod"

import { fail, json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { withSecrets } from "@/lib/secrets/guard"
import { answerDevice, lookupDevice, tokenPolicy } from "@/lib/secrets/tokens"

export const POST = (req: Request) =>
  withSecrets(async (me) => {
    const b = await json(req, z.object({ code: z.string().max(20), allow: z.boolean() }))
    if (b instanceof Response) return b
    if (!(await tokenPolicy()).cli) return fail(403, "forbidden", "An admin turned the CLI off.")
    const d = await lookupDevice(b.code)
    if (!(await answerDevice(me.id, b.code, b.allow)))
      return fail(409, "gone", "That code expired or was already answered.")
    await audit(b.allow ? "secrets_cli_approve" : "secrets_cli_deny", { detail: d?.deviceName })
    return Response.json({ ok: true })
  })
