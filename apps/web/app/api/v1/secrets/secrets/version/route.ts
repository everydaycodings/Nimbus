import { cliRoute, principalTarget } from "@/lib/secrets/cli-api"
import { envVersion } from "@/lib/secrets/service"

// The cheap change check. No secrets leave, so it isn't audited.
export const GET = (req: Request) =>
  cliRoute(req, async (p) => {
    const u = new URL(req.url).searchParams
    const t = await principalTarget(p, { project: u.get("project"), env: u.get("env"), path: u.get("path") })
    const version = await envVersion(t.c.projectId, t.envId)
    return Response.json({ version, etag: `"${version}"` })
  })
