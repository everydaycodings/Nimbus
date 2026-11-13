import { z } from "zod"

import { json } from "@/lib/api"
import { auditAs } from "@/lib/audit"
import { actorOf, cliRoute, principalCtx } from "@/lib/secrets/cli-api"
import { issueCert } from "@/lib/secrets/ssh"
import { TokenError } from "@/lib/secrets/tokens"

// CONTRACT.md: POST /ssh/cert. A member's CLI token asks the project's SSH CA for a
// user certificate (1 to 8 hours, key id = their email). Without publicKey a new
// ed25519 key pair is made and its private key comes back once.
export const POST = (req: Request) =>
  cliRoute(req, async (p) => {
    if (p.type !== "user") throw new TokenError(403, "forbidden", "Machine tokens can't ask for SSH certificates.")
    const b = await json(
      req,
      z.object({ project: z.string(), principals: z.array(z.string().max(64)).max(10), ttl: z.number().min(1).max(8).default(1), publicKey: z.string().max(5000).optional() })
    )
    if (b instanceof Response) return b
    const c = await principalCtx(p, b.project)
    const r = await issueCert(c, p.userId, { principals: b.principals, hours: b.ttl, publicKey: b.publicKey })
    await auditAs(actorOf(p), "secrets_ssh_cert_issue", `serial ${r.serial} for ${r.keyId}, principals ${r.principals.join(",")}, ${b.ttl}h (CLI)`, {
      projectId: c.projectId,
      ip: p.ip,
    })
    return Response.json(r, { headers: { "cache-control": "no-store" } })
  })
