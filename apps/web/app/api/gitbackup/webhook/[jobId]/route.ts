// A git host's push webhook for a Git Backup job (made by setWebhook). Checked against the job's own secret in the way
// the job's host signs it (refs.ts hookOk); a push starts a run for that repo only.
import { and, eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { gitBackupJobs, gitBackupRepos } from "@/lib/db/schema"
import { providerOf } from "@/lib/gitbackup/connections"
import { hookOk, hookRepo } from "@/lib/gitbackup/refs"
import { requestRun, webhookSecret } from "@/lib/gitbackup/runner"

export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  if (!/^[0-9a-f-]{36}$/.test(jobId)) return new Response(null, { status: 404 })
  const [job] = await db.select().from(gitBackupJobs).where(eq(gitBackupJobs.id, jobId))
  const secret = job?.webhookEnabled ? webhookSecret(job) : null
  if (!job || !secret) return new Response(null, { status: 404 })
  const raw = await req.text()
  const provider = await providerOf(job)
  if (!hookOk(provider, secret, raw, (n) => req.headers.get(n))) return new Response(null, { status: 401 })
  let body: { object_kind?: string; zen?: string } | null
  try {
    body = JSON.parse(raw)
  } catch {
    return new Response("Not JSON.", { status: 400 })
  }
  // GitHub names the event in a header (a ping when set up); Gitea and Forgejo the same, GitLab in the body.
  // A new branch or tag: "create" (GitHub, Gitea, Forgejo; same repository.full_name), "tag_push" (GitLab).
  const event = provider === "gitlab" ? body?.object_kind : (req.headers.get("x-github-event") ?? req.headers.get("x-gitea-event") ?? req.headers.get("x-forgejo-event"))
  if (event === "ping") return Response.json({ ok: true })
  if (!["push", "create", "tag_push"].includes(event ?? "") || job.paused) return Response.json({ started: 0 })
  const target = hookRepo(provider, body)
  const [repo] = target
    ? await db.select({ id: gitBackupRepos.id }).from(gitBackupRepos).where(and(eq(gitBackupRepos.jobId, jobId), sql`lower(${gitBackupRepos.owner}) = ${target.owner.toLowerCase()}`, sql`lower(${gitBackupRepos.name}) = ${target.name.toLowerCase()}`))
    : []
  if (!repo) return Response.json({ started: 0 })
  // Turned off by an admin (or the repo just left the job): accept the delivery, run nothing.
  const r = await requestRun(job.userId, jobId, { trigger: "webhook", repoId: repo.id }).catch(() => null)
  return Response.json({ started: r?.started ? 1 : 0 })
}
