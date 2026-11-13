import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { cliRoute, isBearer, principalCtx } from "@/lib/secrets/cli-api"
import { projectRoute } from "@/lib/secrets/guard"
import { addEnv, projectDetail, projectEnvs, reorderEnvs } from "@/lib/secrets/service"

// The environments this caller can see. With a bearer token {id} may be the project's slug.
export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  if (isBearer(req))
    return cliRoute(req, async (p) => {
      const c = await principalCtx(p, (await ctx.params).id)
      const envs = (await projectEnvs(c.projectId)).filter((e) => !c.envs || c.envs.includes(e.id))
      return Response.json({ envs: envs.map((e) => ({ slug: e.slug, name: e.name })) })
    })
  return projectRoute("viewer", async (c) =>
    Response.json({ envs: (await projectDetail(c)).envs })
  )(req, ctx)
}

export const POST = projectRoute("admin", async (c, req) => {
  const b = await json(req, z.object({ name: z.string() }))
  if (b instanceof Response) return b
  const id = await addEnv(c, b.name)
  await audit("secrets_env_add", { detail: b.name })
  return Response.json({ id })
})

// New order, as the list of every environment id.
export const PUT = projectRoute("admin", async (c, req) => {
  const b = await json(req, z.object({ order: z.array(uuid).max(100) }))
  if (b instanceof Response) return b
  await reorderEnvs(c, b.order)
  return Response.json({ ok: true })
})
