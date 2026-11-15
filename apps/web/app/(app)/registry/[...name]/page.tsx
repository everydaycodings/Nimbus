import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { RepoSettings, RepoTags } from "@/components/registry-repo"
import { Badge } from "@/components/ui/badge"
import { listHooksFor, repoDetail, registryState, tagDetail, type ImageInfo } from "@/lib/registry/manage"
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

export default async function RepoPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string[] }>
  searchParams: Promise<{ tag?: string }>
}) {
  const me = await requireMember()
  const [{ name }, { tag }] = await Promise.all([params, searchParams])
  if ((await registryState(me.id)) !== "ready") redirect("/registry")
  const full = name.map(decodeURIComponent).join("/")
  const repo = await repoDetail(me.id, full)
  if (!repo) notFound()
  const hooks = repo.isOwner ? await listHooksFor(me.id, repo.namespace, full.slice(repo.namespace.length + 1)) : []
  const detail = tag ? await tagDetail(me.id, full, tag) : null
  const host = endpoint()!.replace(/^https?:\/\//, "")
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header className="grid gap-2">
        <Link
          href="/registry"
          className="flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon className="size-3.5" />
          Container registry
        </Link>
        <h1 className="font-mono text-2xl font-semibold tracking-tight break-all">{repo.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          {repo.isPublic ? "Public" : "Private"} · {repo.tags.length === 1 ? "1 tag" : `${repo.tags.length} tags`} ·{" "}
          <span className="tabular-nums">{sizeOf(repo.bytes)}</span> stored
        </p>
      </header>

      <RepoTags
        repo={repo}
        host={host}
        selected={detail?.tag}
        detail={
          detail && (
            <div id="detail" className="flex flex-col gap-3">
              <h3 className="sr-only">Details for {detail.tag}</h3>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{detail.mediaType.replace("application/vnd.", "")}</span> ·{" "}
                {detail.images.length > 1 ? `${detail.images.length} platforms` : "1 image"}
              </p>
              <div className="divide-y">
                {detail.images.map((img) => (
                  <Image key={img.digest} img={img} />
                ))}
              </div>
            </div>
          )
        }
      />

      <RepoSettings repo={repo} hooks={hooks} />
    </div>
  )
}
