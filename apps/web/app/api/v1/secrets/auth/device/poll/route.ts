import { cliFail, cliGuard } from "@/lib/secrets/cli-api"
import { limitTokenIp, pollDevice, tokenPolicy } from "@/lib/secrets/tokens"

// 202 while waiting, 200 with the token once, 403 denied, 410 expired or already collected.
export const POST = (req: Request) =>
  cliGuard(req, async () => {
    await limitTokenIp(req, "device-poll", 90)
    if (!(await tokenPolicy()).cli) return cliFail(403, "forbidden", "An admin turned the CLI off.")
    const b = (await req.json().catch(() => ({}))) as { pollToken?: unknown }
    if (typeof b.pollToken !== "string" || b.pollToken.length > 100)
      return cliFail(400, "bad_request", "Send the pollToken.")
    const r = await pollDevice(b.pollToken)
    if (r.state === "pending") return Response.json({ status: "pending" }, { status: 202 })
    if (r.state === "denied") return cliFail(403, "denied", "Sign-in was denied.")
    if (r.state === "expired") return cliFail(410, "expired", "That code expired or was already used.")
    return Response.json({ token: r.token, user: r.user })
  })
