// The build's log as Server-Sent Events for the CLI (`line` {seq, text}, `status` {status, reason}, `end`).
import { canPull } from "@/lib/registry/access"
import { signIn } from "@/lib/registry/auth"
import { buildStream, getBuild } from "@/lib/registry/builds"
import { RegError } from "@/lib/registry/http"
import { db } from "@/lib/db"
import { registryNamespaces, registryRepos } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { ipFrom } from "@/lib/client-ip"

export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor
  try {
    actor = (await signIn(req.headers.get("authorization"), ipFrom(req.headers))).actor
  } catch (e) {
    return Response.json({ error: { code: "unauthorized", message: e instanceof RegError ? e.message : "Sign-in failed." } }, { status: 401 })
  }
  const b = await getBuild((await params).id)
  const [row] = b
    ? await db.select({ repo: registryRepos, ns: registryNamespaces }).from(registryRepos).innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId)).where(eq(registryRepos.id, b.repoId))
    : []
  if (!b || !row || !actor.userId || !(await canPull(actor, row.repo, row.ns)))
    return Response.json({ error: { code: "not_found", message: "No such build." } }, { status: 404 })
  return buildStream(req, b.id)
}
