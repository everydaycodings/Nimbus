import { count, eq, max, sql } from "drizzle-orm"
import { BroomIcon, GlobeHemisphereWestIcon, FilmSlateIcon, GitBranchIcon, PackageIcon, CloudArrowDownIcon, HardDrivesIcon } from "@phosphor-icons/react/dist/ssr"
import type { Icon } from "@phosphor-icons/react"

import { db } from "@/lib/db"
import { gitBackupJobs, gitBackupRepos, registryMirrors, registryRules, registryToolRuns, serverBackupJobs } from "@/lib/db/schema"
import { archiveStatus } from "@/lib/archive/run"
import { convertStatus } from "@/lib/convert/jobs"
import { importStatus } from "@/lib/import/jobs"
import { ago } from "@/lib/health-rules"
import type { Settings } from "@/lib/signup"

export const MORE_GROUPS = [
  ["backup", "Backup"],
  ["files", "Files & media"],
  ["developer", "Developer"],
] as const

// A card's status line: what to say, and whether something is failing.
export type ToolStatus = { text: string; failing?: boolean }

async function gitBackupStatus(userId: string, now: number): Promise<ToolStatus> {
  const [[j], [r]] = await Promise.all([
    db
      .select({
        jobs: count(),
        last: max(gitBackupJobs.lastRunAt),
        failed: sql<number>`count(*) filter (where ${gitBackupJobs.lastStatus} = 'failed')`.mapWith(Number),
      })
      .from(gitBackupJobs)
      .where(eq(gitBackupJobs.userId, userId)),
    db
      .select({
        n: count(),
        next: sql<Date | null>`min(${gitBackupRepos.nextDueAt}) filter (where ${gitBackupJobs.paused} = false and ${gitBackupRepos.status} <> 'gone')`.mapWith((v) => (v ? new Date(v) : null)),
      })
      .from(gitBackupRepos)
      .innerJoin(gitBackupJobs, eq(gitBackupRepos.jobId, gitBackupJobs.id))
      .where(eq(gitBackupJobs.userId, userId)),
  ])
  if (j.jobs === 0) return { text: "Not set up" }
  const last = `${j.last ? `Last backup ${ago(j.last.toISOString(), now)}` : "No backup yet"} · ${r.n === 1 ? "1 repo" : `${r.n} repos`}`
  const next = r.next ? ` · Next ${r.next.getTime() <= now ? "due now" : `in ${Math.max(1, Math.round((r.next.getTime() - now) / 60_000))} min`}` : ""
  return { text: last + next, failing: j.failed > 0 }
}

async function registryToolsStatus(userId: string, now: number): Promise<ToolStatus> {
  const [[r], [m], [run]] = await Promise.all([
    db.select({ n: count(), failed: sql<number>`count(*) filter (where ${registryRules.lastStatus} = 'failed')`.mapWith(Number) }).from(registryRules).where(eq(registryRules.userId, userId)),
    db.select({ n: count(), failed: sql<number>`count(*) filter (where ${registryMirrors.lastStatus} = 'failed')`.mapWith(Number) }).from(registryMirrors).where(eq(registryMirrors.userId, userId)),
    db.select({ last: max(registryToolRuns.finishedAt) }).from(registryToolRuns).where(eq(registryToolRuns.userId, userId)),
  ])
  if (r.n + m.n === 0) return { text: "Not set up" }
  const what = [r.n && `${r.n} ${r.n === 1 ? "rule" : "rules"}`, m.n && `${m.n} ${m.n === 1 ? "mirror" : "mirrors"}`].filter(Boolean).join(" · ")
  return { text: `${what} · ${run.last ? `Last run ${ago(run.last.toISOString(), now)}` : "No run yet"}`, failing: r.failed + m.failed > 0 }
}

async function serverBackupStatus(userId: string, now: number): Promise<ToolStatus> {
  const [j] = await db
    .select({
      jobs: count(),
      last: max(serverBackupJobs.lastRunAt),
      next: sql<Date | null>`min(${serverBackupJobs.nextDueAt}) filter (where ${serverBackupJobs.paused} = false)`.mapWith((v) => (v ? new Date(v) : null)),
      failed: sql<number>`count(*) filter (where ${serverBackupJobs.lastStatus} = 'failed')`.mapWith(Number),
    })
    .from(serverBackupJobs)
    .where(eq(serverBackupJobs.userId, userId))
  if (j.jobs === 0) return { text: "Not set up" }
  const last = `${j.last ? `Last backup ${ago(j.last.toISOString(), now)}` : "No backup yet"} · ${j.jobs === 1 ? "1 job" : `${j.jobs} jobs`}`
  const next = j.next ? ` · Next ${j.next.getTime() <= now ? "due now" : `in ${Math.max(1, Math.round((j.next.getTime() - now) / 60_000))} min`}` : ""
  return { text: last + next, failing: j.failed > 0 }
}

// Tools on the More page. A tool shows only while its admin switch is on.
export const MORE_TOOLS: {
  id: string
  href: string
  name: string
  text: string
  icon: Icon
  group: (typeof MORE_GROUPS)[number][0]
  enabled: (s: Settings) => boolean
  status?: (userId: string, now: number) => Promise<ToolStatus>
}[] = [
  {
    id: "github-backup",
    href: "/more/github-backup",
    name: "Git Backup",
    text: "Back up your git repos to S3 on a schedule",
    icon: GitBranchIcon,
    group: "backup",
    enabled: (s) => s.gitBackupEnabled,
    status: gitBackupStatus,
  },
  {
    id: "server-backup",
    href: "/more/server-backup",
    name: "Server backup",
    text: "Back up folders and Docker volumes from your servers over SSH, encrypted, to S3",
    icon: HardDrivesIcon,
    group: "backup",
    enabled: (s) => s.serverBackupEnabled,
    status: serverBackupStatus,
  },
  {
    id: "cleanup",
    href: "/more/cleanup",
    name: "Clean up",
    text: "Find duplicates, similar photos, big files and ones you never open",
    icon: BroomIcon,
    group: "files",
    enabled: (s) => s.cleanupToolEnabled,
  },
  {
    id: "convert",
    href: "/more/convert",
    name: "Media converter",
    text: "Convert, compress and trim video, audio and images",
    icon: FilmSlateIcon,
    group: "files",
    enabled: (s) => s.convertToolEnabled,
    status: convertStatus,
  },
  {
    id: "registry-tools",
    href: "/more/registry-tools",
    name: "Registry tools",
    text: "Clean up old image tags and mirror images from other registries",
    icon: PackageIcon,
    group: "developer",
    enabled: (s) => s.registryToolsEnabled && s.registry,
    status: registryToolsStatus,
  },
  {
    id: "archive",
    href: "/more/archive",
    name: "Website archive",
    text: "Save web pages as HTML, PDF, a screenshot and text, and keep new versions",
    icon: GlobeHemisphereWestIcon,
    group: "backup",
    enabled: (s) => s.archiverToolEnabled,
    status: archiveStatus,
  },
  {
    id: "import",
    href: "/more/import",
    name: "Cloud import",
    text: "Bring files over from Google Drive, Dropbox, OneDrive, S3, WebDAV, SFTP and Google Takeout",
    icon: CloudArrowDownIcon,
    group: "files",
    enabled: (s) => s.importToolEnabled,
    status: importStatus,
  },
]

export const moreTools = (s: Settings) => MORE_TOOLS.filter((t) => t.enabled(s))
