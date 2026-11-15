import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { ArtifactList, PullsChart } from "@/components/registry-insights"
import { RepoReadme } from "@/components/registry-readme"
import { ActivityList } from "@/components/registry-activity"
import { MovedBanner, PullCommand, RepoHeader, RepoStats } from "@/components/registry-overview"
import { RepoSettings, RepoTabs, RepoTags, type RepoTab, type TagExtra } from "@/components/registry-repo"
import { ArchivedStrip } from "@/components/registry-settings"
import { activityPage } from "@/app/(app)/registry/actions"
import { VulnList } from "@/components/registry-scan"
import { Heading, SECTION } from "@/components/registry-ui"
import { Badge } from "@/components/ui/badge"
import { adminRepoAccess, listHooksFor, ownedNamespaces, repoDetail, registryState, tagDetail, type ImageInfo, type RepoDetail } from "@/lib/registry/manage"
import { artifactsFor } from "@/lib/registry/artifacts"
import { readmeFor } from "@/lib/registry/readme"
import { scanAvailable, scanReport, scanSummaries } from "@/lib/registry/scan"
import { pullStats, tagPulls } from "@/lib/registry/stats"
import { endpoint } from "@/lib/registry/rules"
import { sizeOf } from "@/lib/registry/size"
import { requireMember } from "@/lib/session"

export const metadata = { title: "Container registry · Nimbus" }

const argv = (a: string[] | null) => (a?.length ? a.join(" ") : "")
const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <h4 className="text-sm font-medium">{title}</h4>
      {children}
    </div>
  )
}

const MONO = "overflow-x-auto rounded-md bg-input/20 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all"

function Image({ img }: { img: ImageInfo }) {
  const total = img.layers.reduce((a, l) => a + l.size, 0)
  return (
    <div className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono">
          {img.platform ?? "image"}
        </Badge>
        <span className="text-xs text-muted-foreground tabular-nums">
          {img.layers.length === 1 ? "1 layer" : `${img.layers.length} layers`} · {sizeOf(total)}
          {img.created ? ` · Built ${dateTime.format(new Date(img.created))}` : ""}
        </span>
        <code className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{img.digest}</code>
      </div>
      {img.missing ? (
        <p className="text-sm text-muted-foreground">This manifest isn&apos;t stored here, so there are no details to show.</p>
      ) : (
        <>
          {(img.entrypoint || img.cmd) && (
            <Block title="Command">
              <pre className={MONO}>
                {img.entrypoint ? `ENTRYPOINT ${argv(img.entrypoint)}\n` : ""}
                {img.cmd ? `CMD ${argv(img.cmd)}` : ""}
              </pre>
            </Block>
          )}
          {(img.workingDir || img.user || img.ports.length > 0) && (
            <Block title="Runtime">
              <pre className={MONO}>
                {[img.workingDir && `WORKDIR ${img.workingDir}`, img.user && `USER ${img.user}`, img.ports.length && `EXPOSE ${img.ports.join(" ")}`]
                  .filter(Boolean)
                  .join("\n")}
              </pre>
            </Block>
          )}
          {img.env.length > 0 && (
            <Block title="Environment">
              <pre className={MONO}>{img.env.join("\n")}</pre>
            </Block>
          )}
          {Object.keys(img.labels).length > 0 && (
            <Block title="Labels">
              <pre className={MONO}>
                {Object.entries(img.labels)
                  .map(([k, v]) => `${k}=${v}`)
                  .join("\n")}
              </pre>
            </Block>
          )}
          <Block title="Layers">
            {img.layers.length === 0 ? (
              <p className="text-sm text-muted-foreground">This image has no layers, only its config.</p>
            ) : (
            <ol className="divide-y overflow-hidden rounded-md border text-xs">
              {img.layers.map((l, i) => (
                <li key={l.digest} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{i + 1}</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={l.digest}>
                    {l.digest}
                  </code>
                  <span className="shrink-0 tabular-nums">{sizeOf(l.size)}</span>
                </li>
              ))}
            </ol>
            )}
          </Block>
          {img.history.length > 0 && (
            <Block title="History">
              <ol className="divide-y overflow-hidden rounded-md border">
                {img.history.map((h, i) => (
                  <li key={i} className="px-3 py-1.5 font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
                    {h.replace(/^\/bin\/sh -c (#\(nop\) )?/, "")}
                  </li>
                ))}
              </ol>
            </Block>
          )}
        </>
      )}
    </div>
  )
}

const TABS = ["overview", "tags", "activity", "settings"] as const

export default async function RepoPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string[] }>
  searchParams: Promise<{ tag?: string; tab?: string }>
}) {
  const me = await requireMember()
  const [{ name }, { tag, tab: rawTab }] = await Promise.all([params, searchParams])
  if ((await registryState(me.id)) !== "ready") redirect("/registry")
  const full = name.map(decodeURIComponent).join("/")
  const repo = await repoDetail(me.id, full)
  if (!repo) notFound()
  const wanted = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as RepoTab) : tag ? "tags" : "overview"
  const tab: RepoTab = (wanted === "activity" && !repo.canActivity) || (wanted === "settings" && !repo.canWrite) ? "overview" : wanted
  const host = endpoint()!.replace(/^https?:\/\//, "")
  const tabs: [RepoTab, string][] = [
    ["overview", "Overview"],
    ["tags", repo.tags.length ? `Tags (${repo.tags.length})` : "Tags"],
    ...(repo.canActivity ? ([["activity", "Activity"]] as [RepoTab, string][]) : []),
    ...(repo.canWrite ? ([["settings", "Settings"]] as [RepoTab, string][]) : []),
  ]
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="grid gap-3">
        <Link
          href="/registry"
          className="flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
        >
          <ArrowLeftIcon className="size-3.5" />
          Container registry
        </Link>
        <RepoHeader repo={repo} />
      </header>
      <RepoTabs name={repo.fullName} tab={tab} tabs={tabs} />
      {tab === "overview" && <Overview repo={repo} host={host} />}
      {tab === "tags" && <TagsTab repo={repo} host={host} tag={tag} meId={me.id} />}
      {tab === "activity" && (
        <section className="flex flex-col gap-3" aria-labelledby="activity-heading">
          <Heading id="activity-heading" title="Activity" hint="Pushes, deletes and changes to this repository, kept for 90 days." />
          <ActivityList scope={{ repoId: repo.id }} initial={await activityPage({ repoId: repo.id }, {})} />
        </section>
      )}
      {tab === "settings" && <SettingsTab repo={repo} meId={me.id} full={full} />}
    </div>
  )
}

async function Overview({ repo, host }: { repo: RepoDetail; host: string }) {
  const [days, readme] = await Promise.all([pullStats(repo.id, 30), readmeFor(repo.id)])
  const tagName = repo.tags.find((t) => t.name === "latest")?.name ?? repo.tags[0]?.name
  return (
    <div className="flex flex-col gap-8">
      {repo.moved && <MovedBanner from={repo.moved.from} until={repo.moved.until} />}
      <ArchivedStrip repo={repo} />
      {tagName ? (
        <PullCommand command={`docker pull ${host}/${repo.fullName}:${tagName}`} />
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-6 text-sm text-pretty text-muted-foreground">
          Nothing pushed yet. Log in with <span className="font-mono">docker login {host} -u {repo.namespace}</span>, then push an image to{" "}
          <span className="font-mono break-all">
            {host}/{repo.fullName}
          </span>
          .
        </p>
      )}
      <RepoStats repo={repo} days={days} />
      <RepoReadme name={repo.fullName} canWrite={repo.canWrite && !repo.archived} readme={readme} />
      <section className={SECTION} aria-labelledby="pulls-heading">
        <Heading id="pulls-heading" title="Pulls" hint="Pulls of every tag in this repository, by day." />
        <PullsChart days={days} />
      </section>
    </div>
  )
}

async function SettingsTab({ repo, meId, full }: { repo: RepoDetail; meId: string; full: string }) {
  const [hooks, scanOn, access, owned] = await Promise.all([
    repo.isOwner ? listHooksFor(meId, repo.namespace, full.slice(repo.namespace.length + 1)) : [],
    scanAvailable(),
    repo.canAdmin ? adminRepoAccess(meId, repo.id) : null,
    repo.isOwner ? ownedNamespaces(meId) : [],
  ])
  return <RepoSettings repo={repo} hooks={hooks} scanOn={scanOn} access={access} targets={owned.length ? owned.map((n) => n.name) : [repo.namespace]} />
}

async function TagsTab({ repo, host, tag, meId }: { repo: RepoDetail; host: string; tag?: string; meId: string }) {
  const detail = tag ? await tagDetail(meId, repo.fullName, tag) : null
  const scanOn = await scanAvailable()
  const manifestIds = repo.tags.flatMap((t) => (t.manifestId ? [t.manifestId] : []))
  const [scans, arts, perTag] = await Promise.all([
    scanOn ? scanSummaries(manifestIds) : ({} as Awaited<ReturnType<typeof scanSummaries>>),
    artifactsFor(repo.id, repo.tags.map((t) => t.digest)),
    tagPulls(repo.id),
  ])
  const extras: Record<string, TagExtra> = Object.fromEntries(
    repo.tags.map((t) => {
      const a = arts[t.digest]
      const scan = t.manifestId ? scans[t.manifestId] : undefined
      return [
        t.name,
        {
          scan: scan ? { status: scan.status, critical: scan.critical, high: scan.high, medium: scan.medium, low: scan.low } : null,
          signed: (a?.signatures ?? 0) > 0,
          sbom: (a?.sboms ?? 0) > 0,
          attestation: (a?.attestations ?? 0) > 0,
          pulls: perTag[t.name] ?? 0,
        },
      ]
    })
  )
  const picked = tag ? repo.tags.find((t) => t.name === tag) : undefined
  const report = scanOn && picked?.manifestId ? await scanReport(picked.manifestId) : null
  return (
    <div className="flex flex-col gap-6">
      <ArchivedStrip repo={repo} />
      <RepoTags
        repo={repo}
        host={host}
        selected={detail?.tag}
        scanOn={scanOn}
        extras={extras}
        detail={
          detail && (
            <div id="detail" className="flex flex-col gap-3">
              <h3 className="sr-only">Details for {detail.tag}</h3>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{detail.mediaType.replace("application/vnd.", "")}</span> ·{" "}
                {detail.images.length > 1 ? `${detail.images.length} platforms` : "1 image"}
              </p>
              {scanOn && picked && (
                <VulnList
                  tag={detail.tag}
                  name={repo.fullName}
                  summary={extras[picked.name].scan}
                  vulns={report?.vulns ?? []}
                  error={report?.error ?? null}
                  canRescan={repo.canWrite}
                />
              )}
              {picked && <ArtifactList tag={detail.tag} items={arts[picked.digest]?.items ?? []} />}
              <div className="divide-y">
                {detail.images.map((img) => (
                  <Image key={img.digest} img={img} />
                ))}
              </div>
            </div>
          )
        }
      />
    </div>
  )
}
