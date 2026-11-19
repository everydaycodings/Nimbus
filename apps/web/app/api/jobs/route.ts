// The worker (scripts/worker.ts) hands queued and scheduled jobs here, because
// they reuse the app's database, storage and email code. Anything but a 2xx
// makes the worker try the job again later.
import { and, eq, isNull } from "drizzle-orm"

import { db } from "@/lib/db"
import { registryNamespaces, registryRepos } from "@/lib/db/schema"
import { purgeActivity } from "@/lib/activity"
import { backupAlert } from "@/lib/backup/alert"
import { sweepJunk } from "@/lib/dav/locks"
import { sendNow, type Message } from "@/lib/email"
import { purgeExpiredTrash } from "@/lib/files"
import { sweepOrphans } from "@/lib/orphan-sweep"
import { warnExpiring as warnGitTokens } from "@/lib/gitbackup/alerts"
import { runJob as runGitBackup } from "@/lib/gitbackup/runner"
import { tick as gitBackupTick } from "@/lib/gitbackup/scheduler"
import { sendPush } from "@/lib/push"
import { computeEtags } from "@/lib/s3api/etags"
import { checkRegistryQuota, namespaceOwners } from "@/lib/registry/events"
import { runGc, purgeTrash } from "@/lib/registry/gc"
import { deliver as deliverRegistryHook } from "@/lib/registry/hooks"
import { expireMirror } from "@/lib/registry/mirror"
import { purgeEvents } from "@/lib/registry/activity"
import { purgeAliases } from "@/lib/registry/repo-admin"
import { EVENT_DAYS } from "@/lib/registry/rules"
import { applyPolicy, effectivePolicy } from "@/lib/registry/policy"
import { backfillConnections, warnExpiring } from "@/lib/registry/connections"
import { runAdvice } from "@/lib/registry/advice"
import { runRescan, runScan } from "@/lib/registry/scan"
import { abortStale as abortStaleUploads } from "@/lib/registry/uploads"
import { abortStale } from "@/lib/s3api/multipart"
import { remindKeys } from "@/lib/s3api/reminders"
import { runAllLifecycles } from "@/lib/s3api/lifecycle"
import { flushUsage, rollupUsage } from "@/lib/s3api/usage"
import { scanNode, scanUser } from "@/lib/secrets/leaks"
import { sweep as secretsSweep } from "@/lib/secrets/notices"
import { runRootRotation } from "@/lib/secrets/root-rotate"
import { runPush } from "@/lib/secrets/push"
import { expireLease } from "@/lib/secrets/dynamic"
import { deliver } from "@/lib/secrets/webhooks"
import { notify } from "@/lib/notify"
import { recheckWarned } from "@/lib/quota"
import { removeObjects } from "@/lib/s3"
import { remindExpiring } from "@/lib/services/documents"
import { alertStalePhones } from "@/lib/services/phone-backup"
import { purgeTransfers } from "@/lib/services/transfers"
import { readToken } from "@/lib/upload-rules"
import { finishTusUpload } from "@/lib/uploads"

// Every live repo with a policy (its own or its namespace's); one bell per namespace owner when something went.
async function runPolicies() {
  const repos = await db
    .select({ id: registryRepos.id, name: registryRepos.name, namespaceId: registryRepos.namespaceId, ns: registryNamespaces.name })
    .from(registryRepos)
    .innerJoin(registryNamespaces, eq(registryNamespaces.id, registryRepos.namespaceId))
    .where(and(isNull(registryRepos.deletedAt), isNull(registryRepos.archivedAt)))
  const removed = new Map<string, { name: string; tags: number; untagged: number }>()
  for (const r of repos) {
    if (!(await effectivePolicy(r.id))) continue
    const done = await applyPolicy(r.id)
    if (!done.tags.length && !done.untagged.length) continue
    const t = removed.get(r.namespaceId) ?? { name: r.ns, tags: 0, untagged: 0 }
    t.tags += done.tags.length
    t.untagged += done.untagged.length
    removed.set(r.namespaceId, t)
  }
  for (const [namespaceId, t] of removed) {
    for (const id of await namespaceOwners(namespaceId))
      await notify(id, "registry_cleanup", { data: { name: t.name, tags: String(t.tags), untagged: String(t.untagged) } })
    await checkRegistryQuota(namespaceId)
  }
}

const jobs: Record<string, (data: never) => Promise<unknown>> = {
  purge: async () => {
    await purgeExpiredTrash()
    await purgeActivity()
    await purgeTransfers()
    await sweepJunk()
    await recheckWarned()
  },
  "orphan-sweep": sweepOrphans,
  "s3-etags": computeEtags,
  "s3-multipart-stale": abortStale,
  "s3-key-reminders": remindKeys,
  "s3-lifecycle": runAllLifecycles,
  "s3-usage-flush": flushUsage,
  "s3-usage-rollup": rollupUsage,
  "registry-uploads-stale": abortStaleUploads,
  "registry-gc": () => runGc(),
  "registry-trash-purge": purgeTrash,
  "registry-policy": runPolicies,
  "registry-aliases-purge": purgeAliases,
  "registry-events-purge": () => purgeEvents(EVENT_DAYS),
  "registry-mirror-expire": expireMirror,
  "registry-scan": ({ manifestId }: { manifestId: string }) => runScan(manifestId),
  "registry-rescan": runRescan,
  "registry-advice": ({ repoId, digest }: { repoId: string; digest: string }) => runAdvice(repoId, digest),
  // Once (a Redis flag stops repeats); `{ force: true }` runs it again.
  "registry-connections-backfill": (d?: { force?: boolean }) => backfillConnections(d ?? {}),
  "registry-connections-expiry": warnExpiring,
  "registry-webhook": ({ id }: { id: string }) => deliverRegistryHook(id),
  "git-backup-tick": gitBackupTick,
  "git-backup-expiry": warnGitTokens,
  "git-backup-run": ({ runId, repoIds }: { runId: string; repoIds: string[] }) => runGitBackup(runId, repoIds),
  "phone-backup-stale": alertStalePhones,
  "documents-remind": remindExpiring,
  email: (m: Message) => sendNow(m),
  "delete-keys": ({ keys }: { keys: string[] }) => removeObjects(keys),
  "backup-alert": backupAlert,
  "secrets-sweep": secretsSweep,
  "leak-scan": ({ nodeId }: { nodeId: string }) => scanNode(nodeId),
  "leak-scan-user": ({ userId }: { userId: string }) => scanUser(userId),
  "secrets-rotate-root": runRootRotation,
  "secrets-push": ({ envId }: { envId: string }) => runPush(envId),
  "secrets-webhook": ({ id }: { id: string }) => deliver(id),
  "secrets-lease-expire": ({ id }: { id: string }) => expireLease(id),
  push: ({ userId, id }: { userId: string; id: string }) => sendPush(userId, id),
  // An error here (not ours, gone) won't fix itself; only a throw is retried.
  "tus-finish": async ({ id }: { id: string }) => {
    const done = await finishTusUpload(id)
    if (done.error) console.error("tus-finish", id, done.error)
  },
}

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "")
  const t = readToken("job", token)
  if (!t || t.exp < Date.now()) return new Response(null, { status: 401 })
  const { name, data } = (await req.json()) as { name: string; data: never }
  const run = jobs[name]
  if (!run) return new Response(`No job called ${name}.`, { status: 400 })
  try {
    await run(data)
  } catch (e) {
    console.error(`[job] ${name}:`, e)
    return new Response((e as Error).message, { status: 500 })
  }
  return new Response(null, { status: 204 })
}
