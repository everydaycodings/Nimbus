import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { deleteHost, hostBody, saveHost } from "@/lib/secrets/ssh"

type P = { hostId: string }

export const PUT = projectRoute<P>("developer", async (c, req, p) => {
  const b = await json(req, hostBody)
  if (b instanceof Response) return b
  await saveHost(c, b, p.hostId)
  await audit("secrets_ssh_host_save", { detail: `edited ${b.name} (${b.username}@${b.host}:${b.port})` })
  return Response.json({ ok: true })
})

export const DELETE = projectRoute<P>("developer", async (c, _req, p) => {
  const name = await deleteHost(c, p.hostId)
  await audit("secrets_ssh_host_delete", { detail: name })
  return Response.json({ ok: true })
})
