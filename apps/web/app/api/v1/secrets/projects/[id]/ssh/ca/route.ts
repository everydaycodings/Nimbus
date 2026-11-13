import { z } from "zod"

import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { caView, setupCa } from "@/lib/secrets/ssh"

export const GET = projectRoute("viewer", async (c) => Response.json(await caView(c)))

// Create the CA, or rotate its key.
export const POST = projectRoute("admin", async (c, req) => {
  const b = await json(req, z.object({ rotate: z.boolean().default(false) }))
  if (b instanceof Response) return b
  const fp = await setupCa(c, b.rotate)
  await audit(b.rotate ? "secrets_ssh_ca_rotate" : "secrets_ssh_ca_create", { detail: fp })
  return Response.json({ ok: true })
})
