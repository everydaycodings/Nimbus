// Push hook for any git server (Gitea, Forgejo, GitLab, cgit scripts...). The secret comes as the
// X-Nimbus-Token or X-Gitlab-Token header, a ?token= parameter, or Gitea's X-Gitea-Signature (HMAC of the body).
import { createHmac, timingSafeEqual } from "node:crypto"

import { parseRef } from "@/lib/registry/build-rules"
import { recordDelivery, sourceById, triggerRef } from "@/lib/registry/builds"

export const dynamic = "force-dynamic"

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export async function POST(req: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const src = await sourceById((await params).sourceId, "git")
  if (!src) return new Response(null, { status: 404 })
  const raw = await req.text()
  const h = req.headers
  const given = h.get("x-nimbus-token") ?? h.get("x-gitlab-token") ?? new URL(req.url).searchParams.get("token")
  const sig = h.get("x-gitea-signature") ?? h.get("x-gogs-signature") ?? h.get("x-forgejo-signature")
  const ok =
    (given !== null && same(given, src.secret)) ||
    (sig !== null && same(sig.replace(/^sha256=/, ""), createHmac("sha256", src.secret).update(raw).digest("hex")))
  if (!ok) return new Response(null, { status: 401 })
  await recordDelivery(src.id)
  let p: { ref?: string; after?: string; checkout_sha?: string | null }
  try {
    p = JSON.parse(raw)
  } catch {
    return new Response("Not JSON.", { status: 400 })
  }
  const ref = p.ref ? parseRef(p.ref) : null
  const sha = p.after ?? p.checkout_sha ?? null
  if (!ref || (sha && /^0+$/.test(sha))) return Response.json({ started: 0 })
  return Response.json(await triggerRef(src.id, ref, sha))
}
