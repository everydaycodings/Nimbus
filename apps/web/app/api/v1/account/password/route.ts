import { z } from "zod"

import { fail, json } from "@/lib/api"
import * as svc from "@/lib/services/account"
import { getSession } from "@/lib/session"

// Not withMember: this is how an account on a temporary password gets out of
// that gate. Checks the current password, applies the owner's password policy,
// clears the temporary flag, and signs out every other device.
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return fail(401, "signed-out", "Sign in first.")
  const b = await json(req, z.object({ current: z.string(), next: z.string() }))
  if (b instanceof Response) return b
  const r = await svc.changePassword(session.user, b.current, b.next)
  return r?.error ? fail(400, "refused", r.error) : Response.json({ ok: true })
}
