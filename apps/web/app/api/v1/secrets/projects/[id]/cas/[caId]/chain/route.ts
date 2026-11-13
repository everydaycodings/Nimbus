import { uuid } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { caChain } from "@/lib/secrets/pki"

// The CA certificate and its parents: public material, for trust stores.
export const GET = projectRoute<{ caId: string }>("viewer", async (c, _r, p) => {
  const { pem, name } = await caChain(c, uuid.parse(p.caId))
  await audit("secrets_ca_chain", { detail: name })
  return new Response(pem, { headers: { "content-type": "application/x-pem-file", "content-disposition": `attachment; filename="${name.replace(/[^a-z0-9.-]+/gi, "_")}-chain.pem"` } })
})
