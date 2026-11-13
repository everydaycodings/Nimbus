import { z } from "zod"

import { json } from "@/lib/api"
import { audit } from "@/lib/audit"
import { projectRoute } from "@/lib/secrets/guard"
import { canUse, createKey, listKeys } from "@/lib/secrets/ssh"

export const GET = projectRoute("viewer", async (c) => Response.json({ keys: await listKeys(c), can: { use: canUse(c), admin: c.role === "admin" } }))

// Generate a key here, or import a pasted/uploaded one.
export const POST = projectRoute("developer", async (c, req) => {
  const b = await json(
    req,
    z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("generate"), name: z.string(), kind: z.enum(["ed25519", "rsa"]), comment: z.string().max(100).optional(), passphrase: z.string().max(200).optional() }),
      z.object({ mode: z.literal("import"), name: z.string(), privateKey: z.string().max(20_000), passphrase: z.string().max(200).optional(), comment: z.string().max(100).optional() }),
    ])
  )
  if (b instanceof Response) return b
  const k = await createKey(c, b)
  await audit("secrets_ssh_key_add", { detail: `${k.name} (${k.kind}, ${b.mode === "generate" ? "generated" : "imported"}) ${k.fingerprint}` })
  return Response.json(k)
})
