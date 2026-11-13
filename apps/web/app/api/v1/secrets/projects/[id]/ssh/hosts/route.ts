import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { hostBody, listHosts, saveHost } from "@/lib/secrets/ssh"

export const GET = projectRoute("viewer", async (c) => Response.json({ hosts: await listHosts(c) }))

export const POST = projectRoute("developer", async (c, req) => {
  const b = await json(req, hostBody)
  if (b instanceof Response) return b
  const id = await saveHost(c, b)
  await audit("secrets_ssh_host_save", { detail: `added ${b.name} (${b.username}@${b.host}:${b.port})` })
  return Response.json({ id })
})
