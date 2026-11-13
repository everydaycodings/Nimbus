import { z } from "zod"

import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { withSecrets } from "@/lib/secrets/guard"
import { createProject, listProjects } from "@/lib/secrets/service"

export const GET = () =>
  withSecrets(async (me) => Response.json({ projects: await listProjects(me.id) }))

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
