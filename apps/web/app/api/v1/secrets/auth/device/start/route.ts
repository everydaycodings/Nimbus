import { cliFail, cliGuard, serverUrl } from "@/lib/secrets/cli-api"
import { DEVICE_TTL_S, clientIp, limitTokenIp, startDevice, tokenPolicy } from "@/lib/secrets/tokens"

// The CLI asks for a code; the member approves it on /secrets/cli (CONTRACT.md).
export const POST = (req: Request) =>
  cliGuard(req, async () => {
    await limitTokenIp(req, "device-start", 20)
    if (!(await tokenPolicy()).cli) return cliFail(403, "forbidden", "An admin turned the CLI off.")
    const b = (await req.json().catch(() => ({}))) as { deviceName?: unknown }
    const s = await startDevice(String(b.deviceName ?? ""), clientIp(req))
    return Response.json({
      userCode: s.userCode,
      verifyUrl: `${serverUrl(req)}/secrets/cli?code=${s.userCode}`,
      pollToken: s.pollToken,
      expiresIn: DEVICE_TTL_S,
      interval: 2,
    })
  })
