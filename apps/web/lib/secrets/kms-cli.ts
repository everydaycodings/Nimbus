// KMS over bearer tokens (CONTRACT.md, "KMS"). A machine token needs the matching
// scope (kms:encrypt, kms:decrypt, kms:sign, kms:verify); a member's CLI token follows
// their project role (viewers verify, developers and admins do all four).
import "server-only"

import { auditAs } from "@/lib/audit"
import { actorOf, cliFail, principalCtx } from "./cli-api"
import { kmsOperation, listKmsKeys, type KmsOp, type OpInput } from "./kms-api"
import { db } from "@/lib/db"
import { secretTokens } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import type { Principal } from "./tokens"

export async function allowedKms(p: Principal, role: string, op: KmsOp | "list") {
  if (p.type === "user") return op === "verify" || op === "list" || role !== "viewer"
  const [t] = await db.select({ s: secretTokens.scopes }).from(secretTokens).where(eq(secretTokens.id, p.tokenId))
  const s = t?.s ?? []
  return op === "list" ? s.some((x) => x.startsWith("kms:")) : s.includes(`kms:${op}`)
}

export async function kmsKeysFor(p: Principal, project: string | null) {
  const c = await principalCtx(p, project)
  if (!(await allowedKms(p, c.role, "list"))) return cliFail(403, "forbidden", "This token has no KMS scope.")
  return Response.json({ keys: (await listKmsKeys(c)).map((k) => ({ name: k.name, kind: k.kind, state: k.state, latest: k.latest })) })
}

export async function kmsRun(p: Principal, project: string | null, op: KmsOp, input: OpInput) {
  const c = await principalCtx(p, project)
  if (!(await allowedKms(p, c.role, op))) return cliFail(403, "forbidden", `This token can't ${op} with KMS keys.`)
  const r = await kmsOperation(c, op, input)
  await auditAs(actorOf(p), `secrets_kms_${op}`, `${r.detail} (${p.type === "machine" ? "machine token" : "CLI"}, ${p.ip ?? "?"})`, { projectId: c.projectId, ip: p.ip })
  return Response.json(r.out, { headers: { "cache-control": "no-store" } })
}
