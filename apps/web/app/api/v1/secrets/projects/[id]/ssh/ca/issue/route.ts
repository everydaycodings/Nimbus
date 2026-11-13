import { z } from "zod"

import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { issueCert } from "@/lib/secrets/ssh"

// Signs a pasted public key, or makes a fresh key pair when publicKey is left out.
export const POST = projectRoute("developer", async (c, req) => {
  const b = await json(
    req,
    z.object({ principals: z.array(z.string().max(64)).max(10), hours: z.number().min(1).max(8), publicKey: z.string().max(5000).optional() })
  )
  if (b instanceof Response) return b
  const r = await issueCert(c, c.userId, b)
  await audit("secrets_ssh_cert_issue", { detail: `serial ${r.serial} for ${r.keyId}, principals ${r.principals.join(",")}, ${b.hours}h${b.publicKey ? "" : ", new key"}` })
  return Response.json(r, { headers: { "cache-control": "no-store" } })
})
