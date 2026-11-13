import { cliRoute, serverUrl } from "@/lib/secrets/cli-api"
import { projectEnvs } from "@/lib/secrets/service"
import { projectSlug } from "@/lib/secrets/tokens"

export const GET = (req: Request) =>
  cliRoute(
    req,
    async (p) => {
      const server = serverUrl(req)
      if (p.type === "user") return Response.json({ type: "user", name: p.name, email: p.email, server })
      const envs = await projectEnvs(p.projectId)
      const mine = envs.filter((e) => p.envIds.includes(e.id))
      return Response.json({
        type: "machine",
        name: p.name,
        server,
        scope: {
          project: await projectSlug(p.projectId),
          ...(mine.length === 1 && { env: mine[0].slug }),
          path: `/${p.path}`,
          access: p.access,
        },
      })
    },
    { open: true }
  )
