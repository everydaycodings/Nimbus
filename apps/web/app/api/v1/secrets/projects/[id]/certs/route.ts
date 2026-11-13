import { z } from "zod"

import { json } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { listCerts, uploadCert } from "@/lib/secrets/pki"

export const GET = projectRoute("viewer", async (c) => Response.json({ certs: await listCerts(c) }))

// Files (PEM, DER or PFX) as base64, plus the PFX or key password.
export const POST = projectRoute("developer", async (c, req) => {
  const b = await json(req, z.object({ name: z.string().max(80).default(""), files: z.array(z.string().max(400_000)).min(1).max(8), password: z.string().max(200).default("") }))
  if (b instanceof Response) return b
  return Response.json(await uploadCert(c, b.name, b.files.map((f) => Buffer.from(f, "base64")), b.password))
})
