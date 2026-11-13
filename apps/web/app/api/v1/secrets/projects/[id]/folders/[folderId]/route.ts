import { z } from "zod"

import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { deleteFolder, renameFolder } from "@/lib/secrets/service"

type P = { folderId: string }

export const PATCH = projectRoute<P>("developer", async (c, req, p) => {
  const b = await json(req, z.object({ name: z.string() }))
  if (b instanceof Response) return b
  await renameFolder(c, p.folderId, b.name)
  return Response.json({ ok: true })
})

export const DELETE = projectRoute<P>("developer", async (c, _, p) => {
  const path = await deleteFolder(c, p.folderId)
  await audit("secrets_folder_delete", { detail: path })
  return Response.json({ ok: true })
})
