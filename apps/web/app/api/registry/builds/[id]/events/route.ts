import { notFound, withMember } from "@/lib/api"
import { repoRole } from "@/lib/registry/access"
import { buildStream, getBuild } from "@/lib/registry/builds"
import { db } from "@/lib/db"
import { registryNamespaces, registryRepos } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export const dynamic = "force-dynamic"

// Server-Sent Events for the web build page: `line` {seq, text}, `status` {status, reason}, `end`.
// Anyone who can pull the repo may watch its builds.
export const GET = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withMember(async (me) => {
    const b = await getBuild((await params).id)
    if (!b) return notFound()
    const [row] = await db
      .select({ repo: registryRepos, ns: registryNamespaces })
      .from(registryRepos)
      .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
      .where(eq(registryRepos.id, b.repoId))
    if (!row || !(await repoRole(me.id, row.ns, row.repo))) return notFound()
    return buildStream(req, b.id)
  })
