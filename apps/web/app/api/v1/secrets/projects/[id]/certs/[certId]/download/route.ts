import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { downloadCert } from "@/lib/secrets/pki"

// POST so a PFX password stays out of URLs and logs. The key and PFX are audited; developers and up only.
export const POST = projectRoute<{ certId: string }>("developer", async (c, req, p) => {
  const b = await json(req, z.object({ format: z.string().max(12), password: z.string().max(200).default("") }))
  if (b instanceof Response) return b
  const f = await downloadCert(c, uuid.parse(p.certId), b.format, b.password)
  return new Response(new Uint8Array(Buffer.from(f.body)), { headers: { "content-type": f.type, "content-disposition": `attachment; filename="${f.filename}"`, "cache-control": "no-store" } })
})
