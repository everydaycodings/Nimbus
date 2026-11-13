import { z } from "zod"

import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { deleteProject, projectDetail, updateProject } from "@/lib/secrets/service"

export const GET = projectRoute("viewer", async (c) =>
  Response.json(await projectDetail(c))
)

export const PATCH = projectRoute("admin", async (c, req) => {
  const b = await json(req, z.object({ name: z.string(), description: z.string().optional() }))
  if (b instanceof Response) return b
  await updateProject(c, b.name, b.description)
  return Response.json({ ok: true })
})

export const DELETE = projectRoute("admin", async (c) => {
  const d = await projectDetail(c)
  await deleteProject(c)
  await audit("secrets_project_delete", { detail: d.name })
  return Response.json({ ok: true })
})
