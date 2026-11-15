import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { ArtifactList, PullsChart } from "@/components/registry-insights"
import { RepoReadme } from "@/components/registry-readme"
import { ActivityList } from "@/components/registry-activity"
import { MovedBanner, PullCommand, RecentTags, RepoHeader, RepoStats } from "@/components/registry-overview"
import { RepoSettings, RepoTabs, type RepoTab } from "@/components/registry-repo"
import { RepoTags, type TagExtra } from "@/components/registry-tags"
import { ArchivedStrip } from "@/components/registry-settings"
import { activityPage } from "@/app/(app)/registry/actions"
import { VulnList } from "@/components/registry-scan"
import { Heading, SECTION } from "@/components/registry-ui"
import { Badge } from "@/components/ui/badge"
import { adminRepoAccess, digestBytes, listHooksFor, ownedNamespaces, repoDetail, registryState, tagDetail, type ImageInfo, type RepoDetail } from "@/lib/registry/manage"
import { artifactsFor } from "@/lib/registry/artifacts"
import { readmeFor } from "@/lib/registry/readme"
import { scanAvailable, scanReport, scanSummaries } from "@/lib/registry/scan"
import { pullStats, tagPulls } from "@/lib/registry/stats"
import { endpoint } from "@/lib/registry/rules"
import { sizeOf } from "@/lib/registry/size"
import { requireMember, isAdmin } from "@/lib/session"
import { BuildDetail } from "@/components/registry-build-detail"
import { BuildsOff, BuildsTab, LatestBuild } from "@/components/registry-builds"
import { PLATFORMS, PRESETS, expandTags } from "@/lib/registry/build-rules"
import { badgeToken, buildFindings, buildsAvailable, cosignPublicKey, getBuild, getSource, lastSuccess, listBuilds, listRules } from "@/lib/registry/builds"
import { appUrl } from "@/lib/email"
import { toItem } from "@/lib/registry/build-view"

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

const TABS = ["overview", "tags", "builds", "activity", "settings"] as const

export default async function RepoPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string[] }>
  searchParams: Promise<{ tag?: string; tab?: string; build?: string }>
}) {
  const me = await requireMember()
  const [{ name }, { tag, tab: rawTab, build }] = await Promise.all([params, searchParams])
  if ((await registryState(me.id)) !== "ready") redirect("/registry")
  const full = name.map(decodeURIComponent).join("/")
  const repo = await repoDetail(me.id, full)
  if (!repo) notFound()
  const wanted = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as RepoTab) : tag ? "tags" : build ? "builds" : "overview"
  const tab: RepoTab = (wanted === "activity" && !repo.canActivity) || (wanted === "settings" && !repo.canWrite) || (wanted === "builds" && !repo.canWrite) ? "overview" : wanted
  const host = endpoint()!.replace(/^https?:\/\//, "")
  const tabs: [RepoTab, string][] = [
    ["overview", "Overview"],
    ["tags", repo.tags.length ? `Tags (${repo.tags.length})` : "Tags"],
    ...(repo.canWrite ? ([["builds", "Builds"]] as [RepoTab, string][]) : []),
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
      {tab === "overview" && <Overview repo={repo} host={host} meId={me.id} />}
      {tab === "tags" && <TagsTab repo={repo} host={host} tag={tag} meId={me.id} />}
      {tab === "builds" && <BuildsPanel repo={repo} meId={me.id} build={build} />}
      {tab === "activity" && (
        <section className="flex flex-col gap-3" aria-label="Activity">
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">Pushes, deletes and changes to this repository, kept for 90 days.</p>
          <ActivityList scope={{ repoId: repo.id }} initial={await activityPage({ repoId: repo.id }, {})} />
        </section>
      )}
      {tab === "settings" && <SettingsTab repo={repo} meId={me.id} full={full} />}
    </div>
  )
}

async function Overview({ repo, host, meId }: { repo: RepoDetail; host: string; meId: string }) {
  const [days, readme, latest] = await Promise.all([
    pullStats(repo.id, 30),
    readmeFor(repo.id),
    repo.canWrite && (await buildsAvailable(meId)).on ? listBuilds(repo.id, { limit: 1 }) : [],
  ])
  const pullTag = repo.tags.find((t) => t.name === "latest") ?? repo.tags[0]
  const pulls = days.reduce((a, d) => a + d.count, 0)
  return (
    <div className="flex flex-col gap-8">
      {repo.moved && <MovedBanner from={repo.moved.from} until={repo.moved.until} />}
      <ArchivedStrip repo={repo} />
      {pullTag ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="order-first lg:order-last">
            <PullCommand image={`${host}/${repo.fullName}`} tag={pullTag.name} digest={pullTag.digest} />
          </div>
          <RecentTags repo={repo} host={host} />
        </div>
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
      {latest[0] && <LatestBuild name={repo.fullName} b={toItem(latest[0])} />}
      <RepoReadme name={repo.fullName} canWrite={repo.canWrite && !repo.archived} readme={readme} />
      {pulls > 0 && (
        <section className={SECTION} aria-labelledby="pulls-heading">
          <Heading id="pulls-heading" title="Pulls" hint="Pulls of every tag in this repository, by day." />
          <PullsChart days={days} />
        </section>
      )}
    </div>
  )
}

async function SettingsTab({ repo, meId, full }: { repo: RepoDetail; meId: string; full: string }) {
  const [hooks, scanOn, access, owned, builds, key, last] = await Promise.all([
    repo.isOwner ? listHooksFor(meId, repo.namespace, full.slice(repo.namespace.length + 1)) : [],
    scanAvailable(),
    repo.canAdmin ? adminRepoAccess(meId, repo.id) : null,
    repo.isOwner ? ownedNamespaces(meId) : [],
    buildsAvailable(meId),
    cosignPublicKey(),
    lastSuccess(repo.id),
  ])
  // A command that verifies something real: the newest successful build's tag, if that image carries a signature.
  const signedTag = last?.digest && last.tags[0] ? ((await artifactsFor(repo.id, [last.digest]))[last.digest]?.signatures ?? 0) > 0 && last.tags[0] : null
  return (
    <RepoSettings
      repo={repo}
      hooks={hooks}
      scanOn={scanOn}
      access={access}
      targets={owned.length ? owned.map((n) => n.name) : [repo.namespace]}
      signing={builds.on ? { host: endpoint()!.replace(/^https?:\/\//, ""), key, signedTag: signedTag || null } : undefined}
    />
  )
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

const arch = () => (process.arch === "arm64" ? "linux/arm64" : "linux/amd64")

async function BuildsPanel({ repo, meId, build }: { repo: RepoDetail; meId: string; build?: string }) {
  const av = await buildsAvailable(meId)
  if (!av.on) {
    const me = await requireMember()
    const setup = !process.env.BUILDKIT_HOST
    return (
      <BuildsOff>
        <p>
          {setup
            ? isAdmin(me.role)
              ? "This server was set up without image builds. Re-run setup.sh and answer yes to “Turn on image builds”, then restart."
              : "Builds are off on this server. An admin can turn them on."
            : av.reason}
        </p>
        {setup && isAdmin(me.role) && (
          <Link href="/admin/system/registry" className="underline underline-offset-4">
            Registry settings
          </Link>
        )}
      </BuildsOff>
    )
  }
  const scanOn = await scanAvailable()
  const b = build ? await getBuild(build) : null
  if (b && b.repoId === repo.id) {
    const tag = repo.tags.find((t) => b.tags.includes(t.name))
    const me = await requireMember()
    const gated = b.status === "failed" && /^Critical vulnerabilities found/i.test(b.reason ?? "")
    const [scans, arts, findings, previous, key] = await Promise.all([
      scanOn && tag?.manifestId ? scanSummaries([tag.manifestId]) : ({} as Awaited<ReturnType<typeof scanSummaries>>),
      b.digest ? artifactsFor(repo.id, [b.digest]) : {},
      gated && b.digest ? buildFindings(repo.id, b.digest) : null,
      b.status === "success" && b.digest ? lastSuccess(repo.id, b.createdAt) : null,
      cosignPublicKey(),
    ])
    const bytes = b.status === "success" && b.digest ? await digestBytes(repo.id, [b.digest, ...(previous?.digest ? [previous.digest] : [])]) : {}
    const scan = tag?.manifestId ? scans[tag.manifestId] : undefined
    const a = b.digest ? (arts as Awaited<ReturnType<typeof artifactsFor>>)[b.digest] : undefined
    const { logTail, ruleSummary, ...row } = b
    return (
      <BuildDetail
        key={b.id}
        name={repo.fullName}
        build={{ ...toItem(row), logTail, ruleSummary }}
        canWrite={repo.canWrite}
        archived={repo.archived}
        scanOn={scanOn}
        scan={scan ? { status: scan.status, critical: scan.critical, high: scan.high, medium: scan.medium, low: scan.low } : null}
        attached={{ signed: (a?.signatures ?? 0) > 0, sbom: (a?.sboms ?? 0) > 0, provenance: (a?.attestations ?? 0) > 0 }}
        host={endpoint()!.replace(/^https?:\/\//, "")}
        isAdmin={isAdmin(me.role)}
        signingOn={Boolean(key)}
        findings={findings}
        size={b.digest && bytes[b.digest] !== undefined ? { now: bytes[b.digest], before: previous?.digest ? (bytes[previous.digest] ?? null) : null } : null}
      />
    )
  }
  const [source, rules, rows] = await Promise.all([getSource(repo.id), listRules(repo.id), listBuilds(repo.id, { limit: 31 })])
  return (
    <BuildsTab
      repo={{ id: repo.id, fullName: repo.fullName, canAdmin: repo.canAdmin, archived: repo.archived, isPublic: repo.isPublic }}
      badge={{ base: appUrl(), token: await badgeToken(repo.id) }}
      source={source && { kind: source.kind, url: source.url, hasCredential: source.hasCredential, webhookUrl: source.webhookUrl, lastDeliveryAt: source.lastDeliveryAt?.toISOString() ?? null }}
      rules={rules.map((r) => ({
        id: r.id,
        sourceType: r.sourceType,
        pattern: r.pattern,
        tags: r.tags,
        dockerfile: r.dockerfile,
        context: r.context,
        buildArgs: r.buildArgs,
        secretRefs: r.secretRefs,
        platforms: r.platforms,
        failOnCritical: r.failOnCritical,
        schedule: r.schedule,
        enabled: r.enabled,
        // What a typical push of this rule would tag, e.g. 1.2.3, 1.2, 1 for a semver tag.
        preview: expandTags(r.tags, { sha: "a1b2c3d4e5f6", ...(r.sourceType === "tag" ? { tag: /^re:|[*?,]/.test(r.pattern) ? "v1.2.3" : r.pattern } : { branch: /^re:|[*?,]/.test(r.pattern) ? "main" : r.pattern }) }),
      }))}
      presets={PRESETS}
      platforms={PLATFORMS}
      initial={{ rows: rows.slice(0, 30).map(toItem), more: rows.length > 30 }}
      scanOn={scanOn}
      arch={arch()}
    />
  )
}
