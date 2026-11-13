import { z } from "zod"

import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { deleteKey, renameKey, revealKey } from "@/lib/secrets/ssh"

type P = { keyId: string }

// The private key and passphrase. Always audited; Viewers can't.
export const GET = projectRoute<P>("developer", async (c, _req, p) => {
  const k = await revealKey(c, p.keyId)
  await audit("secrets_ssh_key_reveal", { detail: `${k.name} ${k.fingerprint}` })
  return Response.json(k, { headers: { "cache-control": "no-store" } })
})

export const PATCH = projectRoute<P>("developer", async (c, req, p) => {
  const b = await json(req, z.object({ name: z.string() }))
  if (b instanceof Response) return b
  const old = await renameKey(c, p.keyId, b.name)
  await audit("secrets_ssh_key_rename", { detail: `${old} → ${b.name.trim()}` })
  return Response.json({ ok: true })
})

export const DELETE = projectRoute<P>("admin", async (c, _req, p) => {
  const name = await deleteKey(c, p.keyId)
  await audit("secrets_ssh_key_delete", { detail: name })
  return Response.json({ ok: true })
})
