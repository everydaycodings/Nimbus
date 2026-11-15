import { stageUpload, startUploadBuild } from "@/lib/registry/builds"
import { memberOrNull } from "@/lib/session"

export const dynamic = "force-dynamic"

// The Builds tab's "upload a folder": the raw .zip/.tar body streams into storage, then a build starts.
// ?repo=<repo id>&tags=a,b&dockerfile=Dockerfile. (The CLI uses POST /api/v1/registry/builds with a token.)
export async function POST(req: Request) {
  const me = await memberOrNull()
  if (!me) return Response.json({ error: "Sign in first." }, { status: 401 })
  const q = new URL(req.url).searchParams
  const repoId = q.get("repo") ?? ""
  const tags = (q.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean)
  if (!req.body) return Response.json({ error: "Send the file as the request body." }, { status: 400 })
  const up = await stageUpload(req.body)
  if (!up.tarKey) return Response.json({ error: up.error }, { status: 400 })
  const r = await startUploadBuild(me.id, repoId, { tarKey: up.tarKey, tags, dockerfile: q.get("dockerfile")?.trim() || undefined })
  return r.id ? Response.json({ id: r.id }) : Response.json({ error: r.error }, { status: 400 })
}
