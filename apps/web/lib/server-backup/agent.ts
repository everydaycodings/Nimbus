// The push agent: a shell script the member runs on the server (cron). It asks Nimbus for the job's restic settings with its
// token (only a hash is kept here), runs restic locally, and reports back. Nimbus then lists the snapshots itself.
import "server-only"

import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { serverBackupHosts, serverBackupJobs, serverBackupRuns, settings } from "@/lib/db/schema"
import { appUrl } from "@/lib/email"
import { dest, repoOf } from "./exec"
import { tokenHash } from "./hosts"
import { finish, startAgentRun, syncSnapshots } from "./runner"
import { forgetArgs, repoOpts, resticHost, shq } from "./rules"

// The agent's host (its token is the credential); null for a bad token.
export async function hostForToken(token: string | undefined) {
  if (!token) return null
  const [h] = await db.select().from(serverBackupHosts).where(and(eq(serverBackupHosts.agentTokenHash, tokenHash(token)), eq(serverBackupHosts.mode, "agent")))
  return h ?? null
}

async function jobFor(hostId: string, jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null
  const [j] = await db.select().from(serverBackupJobs).where(and(eq(serverBackupJobs.id, jobId), eq(serverBackupJobs.hostId, hostId)))
  return j ?? null
}

// Shell the script evals: the repository settings and what to back up, quoted by shq.
export async function agentConfig(token: string | undefined, jobId: string): Promise<{ status: number; body: string }> {
  const host = await hostForToken(token)
  if (!host) return { status: 401, body: "Bad token." }
  const job = await jobFor(host.id, jobId)
  if (!job) return { status: 404, body: "No such job for this token." }
  const [s] = await db.select({ on: settings.serverBackupEnabled }).from(settings)
  if (!s?.on) return { status: 403, body: "Server Backup is turned off by an admin." }
  if (job.paused) return { status: 409, body: "This job is paused." }
  const runId = await startAgentRun(job.id)
  if (!runId) return { status: 409, body: "A backup of this job is already running." }
  const r = repoOf(job)
  const arr = (name: string, xs: string[]) => `${name}=(${xs.map(shq).join(" ")})`
  const body = [
    ...Object.entries(r.env).filter(([k]) => k.startsWith("RESTIC_REPOSITORY") || k === "RESTIC_PASSWORD" || k.startsWith("AWS_")).map(([k, v]) => `export ${k}=${shq(String(v))}`),
    `NB_RUN=${shq(runId)}`,
    `NB_HOST=${shq(resticHost(host.id))}`,
    arr("NB_OPTS", repoOpts(dest(job))),
    arr("NB_PATHS", job.paths),
    arr("NB_EXCLUDES", job.excludes.map((e) => `--exclude=${e}`)),
    arr("NB_KEEP", forgetArgs(job.retention)),
    `NB_PRE=${shq(job.preHook)}`,
    `NB_POST=${shq(job.postHook)}`,
    "",
  ].join("\n")
  return { status: 200, body }
}

export async function agentReport(token: string | undefined, jobId: string, f: FormData): Promise<{ status: number; body: string }> {
  const host = await hostForToken(token)
  if (!host) return { status: 401, body: "Bad token." }
  const job = await jobFor(host.id, jobId)
  if (!job) return { status: 404, body: "No such job for this token." }
  const runId = String(f.get("run") ?? "")
  const [run] = /^[0-9a-f-]{36}$/i.test(runId) ? await db.select().from(serverBackupRuns).where(and(eq(serverBackupRuns.id, runId), eq(serverBackupRuns.jobId, job.id), eq(serverBackupRuns.status, "running"))) : []
  if (!run) return { status: 404, body: "No running backup with that id." }
  const num = (k: string) => Math.max(0, Math.round(Number(f.get(k)) || 0))
  const failed = f.get("status") !== "ok"
  const log = String(f.get("log") ?? "").slice(-6000)
  await db.update(serverBackupRuns).set({ logTail: log }).where(eq(serverBackupRuns.id, run.id))
  let error = failed ? String(f.get("error") ?? "").slice(0, 600) || "The agent reported a failure." : undefined
  if (!failed) await syncSnapshots(job, host).catch((e: Error) => void (error = e.message))
  await finish(run.id, job, error, { snapshotId: String(f.get("snapshot") ?? "") || undefined, bytes: num("bytes"), files: num("files") })
  return { status: 204, body: "" }
}

// nimbus-agent.sh for one job. The token is not in it; the member sets NIMBUS_AGENT_TOKEN.
export function agentScript(job: { id: string; name: string }): string {
  return `#!/usr/bin/env bash
# Nimbus Server Backup agent for the job "${job.name.replace(/[^\w .-]/g, "")}". Run it from cron on the server being backed up.
# Needs: restic, curl, and NIMBUS_AGENT_TOKEN set to the token Nimbus showed you for this server.
set -uo pipefail
URL=${shq(appUrl(""))}
JOB=${shq(job.id)}
: "\${NIMBUS_AGENT_TOKEN:?Set NIMBUS_AGENT_TOKEN to the agent token from Nimbus.}"
command -v restic >/dev/null || { echo "restic is not installed here." >&2; exit 2; }
auth=(-H "Authorization: Bearer $NIMBUS_AGENT_TOKEN")
cfg=$(curl -fsS "\${auth[@]}" "$URL/api/server-backup/agent/$JOB") || { echo "Could not get the backup settings from Nimbus." >&2; exit 2; }
eval "$cfg"
log=$(mktemp); trap 'rm -f "$log" "$log.json"' EXIT
status=ok; err=""
fail() { [ "$status" = ok ] && { status=failed; err="$1"; }; return 0; }
if [ -n "$NB_PRE" ]; then bash -c "$NB_PRE" >>"$log" 2>&1 || fail "The pre-backup command failed."; fi
if [ "$status" = ok ]; then
  restic "\${NB_OPTS[@]}" cat config >/dev/null 2>&1 || restic "\${NB_OPTS[@]}" init >>"$log" 2>&1 || fail "Could not open or make the repository."
fi
if [ "$status" = ok ]; then
  restic "\${NB_OPTS[@]}" backup --json --host "$NB_HOST" \${NB_EXCLUDES[@]+"\${NB_EXCLUDES[@]}"} "\${NB_PATHS[@]}" >"$log.json" 2>>"$log" || fail "restic backup failed."
fi
# The post command runs whatever happened.
if [ -n "$NB_POST" ]; then bash -c "$NB_POST" >>"$log" 2>&1 || fail "The post-backup command failed."; fi
if [ "$status" = ok ]; then
  restic "\${NB_OPTS[@]}" forget --host "$NB_HOST" "\${NB_KEEP[@]}" --prune >>"$log" 2>&1 || fail "Removing old snapshots failed."
fi
last() { grep -o "\\"$1\\":[^,}]*" "$log.json" 2>/dev/null | tail -1 | cut -d: -f2 | tr -d '"'; }
curl -fsS -X POST "\${auth[@]}" --data-urlencode "run=$NB_RUN" --data-urlencode "status=$status" --data-urlencode "error=$err" \\
  --data-urlencode "snapshot=$(last snapshot_id)" --data-urlencode "bytes=$(last total_bytes_processed)" --data-urlencode "files=$(last total_files_processed)" \\
  --data-urlencode "log@$log" "$URL/api/server-backup/agent/$JOB" >/dev/null || echo "Could not report the result to Nimbus." >&2
[ "$status" = ok ] || { echo "$err" >&2; tail -n 20 "$log" >&2; exit 1; }
echo "Backed up."
`
}
