import { fail } from "@/lib/api"
import * as svc from "@/lib/services/account"
import { getSession } from "@/lib/session"

// Emails the confirm-your-address link again. Works while that gate is up.
export async function POST() {
  const session = await getSession()
  if (!session) return fail(401, "signed-out", "Sign in first.")
  return Response.json(await svc.resendVerification(session.user))
}
