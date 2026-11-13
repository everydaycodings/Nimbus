import { z } from "zod"

import { json, uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { names } from "@/lib/secrets/format"
import { projectRoute } from "@/lib/secrets/guard"
import { readValues } from "@/lib/secrets/service"

// Values for the rows being revealed or copied. Always logged, by key name.
export const POST = projectRoute("viewer", async (c, req) => {
  const b = await json(
    req,
    z.object({ ids: z.array(uuid).min(1).max(1000), purpose: z.enum(["reveal", "copy"]).default("reveal") })
  )
  if (b instanceof Response) return b
  const values = await readValues(c, b.ids)
  await audit(b.purpose === "copy" ? "secrets_copy" : "secrets_reveal", {
    detail: names(values.map((v) => v.key)),
  })
  return Response.json({ values })
})
