// `nimbus registry build`: the CLI uploads a build context (tar.gz) here and gets {id}, then follows
// /builds/{id}/events. Authenticated with a registry token (NMCR…) that may push to the repository.
import { canPush, createRepoOnPush, resolveRepo } from "@/lib/registry/access"
import { signIn } from "@/lib/registry/auth"
import { RegError } from "@/lib/registry/http"
import { startUploadBuild, stageUpload } from "@/lib/registry/builds"
import { endpoint, splitName } from "@/lib/registry/rules"
import { ipFrom } from "@/lib/client-ip"

export const dynamic = "force-dynamic"
export const maxDuration = 3600

const err = (status: number, message: string) => Response.json({ error: { code: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "bad_request", message } }, { status })

// POST ?repo=ns/name&tag=1.0&tag=latest&platform=linux/arm64&arg=K=V&file=Dockerfile, body: the tar.gz.
export async function POST(req: Request) {
  if (!endpoint()) return err(503, "The container registry isn't turned on on this server.")
  let who
  try {
    who = await signIn(req.headers.get("authorization"), ipFrom(req.headers))
  } catch (e) {
    return e instanceof RegError ? err(e.status, e.message) : err(500, "Sign-in failed.")
  }
  const { actor } = who
  if (!actor.userId) return err(401, "Send a registry token (NMCR…) as a Bearer token.")
  const q = new URL(req.url).searchParams
  const name = q.get("repo") ?? ""
  if (!splitName(name)) return err(400, "repo must be namespace/name.")
  const found = await resolveRepo(name)
  const target = found ?? (await createRepoOnPush(actor, name))
  if (!target || !(await canPush(actor, target.namespace, target.repo))) return err(403, "This token can't push to that repository.")
  if (!req.body) return err(400, "Send the build context as the request body.")
  const args = q.getAll("arg").map((a) => ({ key: a.slice(0, Math.max(0, a.indexOf("="))), value: a.slice(a.indexOf("=") + 1) }))
  // Check everything cheap before the big upload goes into storage.
  const staged = await stageUpload(req.body)
  if (!staged.tarKey) return err(400, staged.error ?? "The upload failed.")
  const r = await startUploadBuild(
    actor.userId,
    target.repo.id,
    { tarKey: staged.tarKey, tags: q.getAll("tag"), platforms: q.getAll("platform"), buildArgs: args, dockerfile: q.get("file") ?? undefined },
    "cli"
  )
  if (!r.id) return err(400, r.error ?? "The build didn't start.")
  return Response.json({ id: r.id })
}
