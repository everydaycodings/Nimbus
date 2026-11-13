import { cliRoute, principalTarget } from "@/lib/secrets/cli-api"
import { envVersion } from "@/lib/secrets/service"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Long-poll: holds until the environment's version differs from `version` or `timeout`
// seconds (max 60) pass. The version is checked once a second.
export const GET = (req: Request) =>
  cliRoute(req, async (p) => {
    const u = new URL(req.url).searchParams
    const t = await principalTarget(p, { project: u.get("project"), env: u.get("env"), path: u.get("path") })
    const since = Number(u.get("version"))
    const end = Date.now() + Math.min(60, Math.max(1, Number(u.get("timeout")) || 25)) * 1000
    for (;;) {
      const version = await envVersion(t.c.projectId, t.envId)
      if (version !== since) return Response.json({ version, changed: true })
      if (Date.now() >= end || req.signal.aborted) return Response.json({ version, changed: false })
      await sleep(1000)
    }
  })
