import { z } from "zod"

import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { cliRoute, isBearer } from "@/lib/secrets/cli-api"
import { withSecrets } from "@/lib/secrets/guard"
import { createProject, listProjects, projectDetail, systemCtx } from "@/lib/secrets/service"

// The web's project cards, or (with a bearer token) CONTRACT.md's { id, slug, name } list.
export const GET = (req: Request) =>
  isBearer(req)
    ? cliRoute(req, async (p) => {
        if (p.type === "user")
          return Response.json({
            projects: (await listProjects(p.userId)).map(({ id, slug, name }) => ({ id, slug, name })),
          })
        const d = await projectDetail((await systemCtx(p.projectId))!)
        return Response.json({ projects: [{ id: d.id, slug: d.slug, name: d.name }] })
      })
    : withSecrets(async (me) => Response.json({ projects: await listProjects(me.id) }))

// New project with Development, Staging and Production; the creator is its admin.
export const POST = (req: Request) =>
  withSecrets(async (me) => {
    const b = await json(
      req,
      z.object({ name: z.string(), description: z.string().optional() })
    )
    if (b instanceof Response) return b
    const id = await createProject(me.id, b.name, b.description)
    await audit("secrets_project_create", { detail: b.name })
    return Response.json({ id })
  })
