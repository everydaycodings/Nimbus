import { fail } from "@/lib/api"
import { getUsage } from "@/lib/quota"
import { gateOf, getSession, hasPassword, isAdmin } from "@/lib/session"
import { getSettings } from "@/lib/signup"

// Who this token is and which gate, if any, comes first. Answers for gated
// accounts too, because the app has to show them their gate.
export async function GET() {
  const session = await getSession()
  if (!session) return fail(401, "signed-out", "Sign in first.")
  const me = session.user
  const gate = await gateOf(me)
  const [password, settings, usage] = await Promise.all([
    hasPassword(me.id),
    getSettings(),
    me.status === "active" ? getUsage(me.id) : null,
  ])
  return Response.json(
    {
      id: me.id,
      name: me.name,
      email: me.email,
      image: me.image ?? null,
      role: me.role,
      canAdmin: isAdmin(me.role),
      twoFactor: Boolean(me.twoFactorEnabled),
      hasPassword: password,
      vaultsEnabled: settings.vaultsEnabled,
      gate,
      usage,
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
