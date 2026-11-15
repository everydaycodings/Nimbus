// GitHub's webhook (push and create), made by connectGithub. The signature is checked against the
// source's own secret; anything else is a 401. Returns what it started so the delivery view in GitHub is readable.
import { parseRef } from "@/lib/registry/build-rules"
import { recordDelivery, sourceById, triggerRef } from "@/lib/registry/builds"
import { verifySignature } from "@/lib/registry/github"
import { redis } from "@/lib/redis"

export const dynamic = "force-dynamic"

const ZERO = /^0+$/

export async function POST(req: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const src = await sourceById((await params).sourceId, "github")
  if (!src) return new Response(null, { status: 404 })
  const raw = await req.text()
  if (!verifySignature(src.secret, raw, req.headers.get("x-hub-signature-256"))) return new Response(null, { status: 401 })
  await recordDelivery(src.id)
  const event = req.headers.get("x-github-event")
  if (event === "ping") return Response.json({ ok: true })
  let p: { ref?: string; after?: string; deleted?: boolean; ref_type?: string }
  try {
    p = JSON.parse(raw)
  } catch {
    return new Response("Not JSON.", { status: 400 })
  }
  let ref = p.ref ? parseRef(p.ref.startsWith("refs/") ? p.ref : `refs/${p.ref_type === "tag" ? "tags" : "heads"}/${p.ref}`) : null
  if (event === "create" && p.ref_type !== "tag") ref = null
  if ((event !== "push" && event !== "create") || !ref || p.deleted || (p.after && ZERO.test(p.after))) return Response.json({ started: 0 })
  // A tag made on GitHub's site sends both create and push: build it once.
  if (ref.type === "tag" && !(await redis.set(`registry:build:hook:${src.id}:${ref.name}`, "1", "EX", 60, "NX").catch(() => "OK")))
    return Response.json({ started: 0, duplicate: true })
  return Response.json(await triggerRef(src.id, ref, p.after ?? null))
}
