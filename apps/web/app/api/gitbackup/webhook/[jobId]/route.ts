// GitHub's push webhook for a Git Backup job (made by setWebhook). Signature checked against the job's own secret;
// a push starts a run for that repo only.
import { and, eq, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { gitBackupJobs, gitBackupRepos } from "@/lib/db/schema"
import { requestRun, webhookSecret } from "@/lib/gitbackup/runner"
import { verifySignature } from "@/lib/registry/github"

export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  if (!/^[0-9a-f-]{36}$/.test(jobId)) return new Response(null, { status: 404 })
  const [job] = await db.select().from(gitBackupJobs).where(eq(gitBackupJobs.id, jobId))
  const secret = job?.webhookEnabled ? webhookSecret(job) : null
  if (!job || !secret) return new Response(null, { status: 404 })
  const raw = await req.text()
  if (!verifySignature(secret, raw, req.headers.get("x-hub-signature-256"))) return new Response(null, { status: 401 })
  const event = req.headers.get("x-github-event")
  if (event === "ping") return Response.json({ ok: true })
  if ((event !== "push" && event !== "create") || job.paused) return Response.json({ started: 0 })
  let full: string | undefined
  try {
    full = (JSON.parse(raw) as { repository?: { full_name?: string } }).repository?.full_name
  } catch {
    return new Response("Not JSON.", { status: 400 })
  }
  const [owner, name] = (full ?? "").split("/")
  const [repo] = owner && name
    ? await db.select({ id: gitBackupRepos.id }).from(gitBackupRepos).where(and(eq(gitBackupRepos.jobId, jobId), sql`lower(${gitBackupRepos.owner}) = ${owner.toLowerCase()}`, sql`lower(${gitBackupRepos.name}) = ${name.toLowerCase()}`))
    : []
  if (!repo) return Response.json({ started: 0 })
  // Turned off by an admin (or the repo just left the job): accept the delivery, run nothing.
  const r = await requestRun(job.userId, jobId, { trigger: "webhook", repoId: repo.id }).catch(() => null)
  return Response.json({ started: r?.started ? 1 : 0 })
}
