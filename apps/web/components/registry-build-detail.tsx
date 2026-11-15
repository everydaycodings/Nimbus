"use client"

import { ArrowClockwiseIcon, ArrowLeftIcon, CheckCircleIcon, CheckIcon, MinusIcon, WarningCircleIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"

import { cancelBuild, fullBuildLog, retryBuild } from "@/app/(app)/registry/build-actions"
import { CopyButton } from "@/components/copy-button"
import { LogViewer } from "@/components/registry-build-log"
import { STATUS, StatusChip, useNow } from "@/components/registry-builds"
import { ScanBadge, VulnList, type ScanSummary, type Vuln } from "@/components/registry-scan"
import { Code, Confirm, TOUCH, WHEN } from "@/components/registry-ui"
import { useNotice } from "@/components/toaster"
import { FormError } from "@/components/two-factor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TRIGGER_LABEL, ago, buildMs, duration, isActive, type BuildItem } from "@/lib/registry/build-view"
import type { BuildStatus } from "@/lib/registry/builds"
import { sizeOf } from "@/lib/registry/size"
import { cn } from "@/lib/utils"

export type BuildDetailProps = {
  name: string
  build: BuildItem & { logTail: string; ruleSummary?: string }
  canWrite: boolean
  archived: boolean
  scan: ScanSummary | null
  scanOn: boolean
  attached: { signed: boolean; sbom: boolean; provenance: boolean }
  host: string
  isAdmin: boolean
  // Signing happens on every build once the server has a key, so "not signed" is only news when this is true.
  signingOn: boolean
  // Critical and High findings of the image a scan-gated build pushed but never tagged.
  findings: { summary: ScanSummary; vulns: Vuln[]; error: string | null } | null
  // This build's image size and the previous successful build's.
  size: { now: number; before: number | null } | null
}

const TAIL_LINES = 200

export function BuildDetail({ name, build, canWrite, archived, scan, scanOn, attached, host, isAdmin, signingOn, findings, size }: BuildDetailProps) {
  const router = useRouter()
  const setNotice = useNotice()
  // What the stream last said, kept only while the server's own copy is still the one it was said against.
  const [live, setLive] = useState<{ status: BuildStatus; reason: string | null; base: string } | null>(null)
  const base = `${build.status}|${build.reason}`
  const fresh = live && live.base === base ? live : null
  const status = fresh?.status ?? build.status
  const reason = fresh ? fresh.reason : build.reason
  const active = isActive(status)
  const [startedActive] = useState(() => isActive(build.status))
  const baseRef = useRef(base)
  useEffect(() => {
    baseRef.current = base
  }, [base])

  // A running build streams its log, and the stream replays everything so far; a finished one shows the stored tail.
  const [lines, setLines] = useState<string[]>(() => (startedActive || !build.logTail ? [] : build.logTail.split("\n")))
  const [full, setFull] = useState(false)
  const [loadingFull, setLoadingFull] = useState(false)
  useEffect(() => {
    if (!startedActive) return
    const buf: string[] = []
    let last = -1
    const es = new EventSource(`/api/registry/builds/${build.id}/events`)
    // Take the lines out before setLines: its updater can run twice.
    const push = () => {
      const chunk = buf.splice(0)
      if (chunk.length) setLines((l) => l.concat(chunk))
    }
    const flush = setInterval(push, 150)
    es.addEventListener("line", (e) => {
      const m = JSON.parse((e as MessageEvent).data) as { seq: number; text: string }
      if (m.seq <= last) return
      last = m.seq
      buf.push(m.text)
    })
    let first = true
    es.addEventListener("status", (e) => {
      const m = JSON.parse((e as MessageEvent).data) as { status: BuildStatus; reason: string | null }
      setLive({ ...m, base: baseRef.current })
      if (!first) router.refresh()
      first = false
    })
    es.addEventListener("end", () => {
      es.close()
      setTimeout(() => (push(), router.refresh()), 200)
    })
    // A 404 or sign-out ends it; the browser would otherwise retry forever.
    es.onerror = () => es.readyState === EventSource.CLOSED && es.close()
    return () => {
      clearInterval(flush)
      es.close()
    }
  }, [build.id, router, startedActive])

  const now = useNow(status === "running")
  const ms = status === "running" ? (now === null ? null : buildMs({ startedAt: build.startedAt, finishedAt: null }, now)) : active || !build.finishedAt ? null : buildMs(build)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string>()
  const act = (fn: () => Promise<{ error?: string; id?: string }>, then?: (id?: string) => void) =>
    start(async () => {
      setError(undefined)
      const r = await fn().catch(() => ({ error: "That didn't work. Try again." }) as { error?: string; id?: string })
      if (r.error) return setError(r.error)
      then?.(r.id)
    })

  const finished = !active
  const gated = status === "failed" && /^Critical vulnerabilities found/i.test(reason ?? "")
  const guard = (reason ?? "").replace(/^Stopped to protect the server:\s*/i, "")
  const lowOn = /^disk/i.test(guard) ? "disk space" : /^load/i.test(guard) ? "processor time" : "memory"
  const explain =
    status === "waiting"
      ? { tone: "text-warning", title: "Waiting for the server", text: reason?.replace(/^Waiting:\s*/i, "") ?? "The server is busy." }
      : status === "stopped"
        ? { tone: "text-warning", title: "Stopped to protect the server", text: `The server was low on ${lowOn} while this build ran${guard ? `: ${guard}` : ""}. The reading is for the whole machine, so other work may have used it too.` }
        : gated
          ? { tone: "text-destructive", title: "Blocked by the vulnerability check", text: `${reason}. This rule's scan gate fails the build on Critical findings, so nothing was tagged. Update the base image in your Dockerfile, then rebuild.` }
          : status === "failed" && reason
            ? { tone: "text-destructive", title: "The build failed", text: reason }
            : null
  const retryLabel = status === "success" || gated ? "Rebuild" : status === "stopped" ? "Rebuild when the server is quiet" : "Retry"
  const tag = build.tags[0]

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/registry/${name}?tab=builds`}
        className="flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
      >
        <ArrowLeftIcon className="size-3.5" />
        All builds
      </Link>

      <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="mr-auto grid min-w-0 gap-2">
          <h2 className="font-mono text-xl font-semibold break-all">{build.ref ?? (build.trigger === "cli" || build.trigger === "upload" ? "Uploaded archive" : "Build")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={status} startedAt={build.startedAt} createdAt={build.createdAt} />
            <span suppressHydrationWarning className="text-sm text-muted-foreground tabular-nums">
              {ms !== null ? duration(ms) : "Not started"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {active && canWrite && (
            <Confirm label="Cancel build" question="Stop this build?" yes="Stop build" pending={pending} danger onYes={() => act(() => cancelBuild(build.id), () => (setNotice({ text: "Cancelling…" }), router.refresh()))} />
          )}
          {finished && canWrite && !archived && (
            <Button
              variant="outline"
              className={TOUCH}
              disabled={pending}
              onClick={() =>
                act(
                  () => retryBuild(build.id),
                  (id) => id && router.push(`/registry/${name}?tab=builds&build=${id}`)
                )
              }
            >
              <ArrowClockwiseIcon />
              {retryLabel}
            </Button>
          )}
        </div>
      </header>

      {status === "success" && (
        <section className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border bg-card p-4" aria-labelledby="result-heading">
          <h3 id="result-heading" className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircleIcon aria-hidden weight="fill" className="size-5 text-brand" />
            Built and pushed
            {size && size.now > 0 && (
              <span className="font-normal text-muted-foreground tabular-nums">
                {sizeOf(size.now)}
                {size.before ? ` · ${size.now === size.before ? "same size as the last build" : `${size.now > size.before ? "+" : "−"}${sizeOf(Math.abs(size.now - size.before))} since the last build`}` : ""}
              </span>
            )}
          </h3>
          {tag && (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
              <PullLine value={`docker pull ${host}/${name}:${tag}`} label="Copy the pull command" />
              {build.digest && <PullLine value={`docker pull ${host}/${name}@${build.digest}`} label="Copy the pull command by digest" />}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {scanOn && <ScanBadge s={scan} />}
            {attached.signed && <Attach label="Signed" />}
            {attached.sbom && <Attach label="SBOM" />}
            {attached.provenance && <Attach label="Provenance" />}
            {signingOn && !attached.signed && (
              <Badge variant="outline" className="h-auto max-w-full py-1 text-left whitespace-normal text-muted-foreground">
                <MinusIcon aria-hidden />
                Not signed. The build runner signs images automatically
              </Badge>
            )}
          </div>
        </section>
      )}

      {explain && (
        <div role="status" className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3">
          <WarningCircleIcon aria-hidden weight="fill" className={cn("mt-0.5 size-5 shrink-0", explain.tone)} />
          <div className="grid min-w-0 gap-0.5">
            <p className="text-sm font-medium">{explain.title}</p>
            {explain.text && <p className="text-sm text-pretty text-muted-foreground">{explain.text}</p>}
            {status === "waiting" && <p className="text-xs text-muted-foreground">It starts by itself when the server has room, and is checked every 30 seconds.</p>}
            {status === "stopped" && (
              <>
                <p className="text-sm text-pretty text-muted-foreground">
                  {isAdmin ? (
                    <>
                      You can{" "}
                      <Link href="/admin/system/registry#registry-build-guard-ram" className="rounded-sm underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                        review the build limits
                      </Link>
                      .
                    </>
                  ) : (
                    "Ask your admin to raise the limits."
                  )}
                </p>
                <p className="text-xs text-muted-foreground">A new build waits at the start until the server has room, so it is safe to start it now.</p>
              </>
            )}
          </div>
        </div>
      )}
      <p role="status" className="sr-only">
        {startedActive && finished ? `Build finished: ${STATUS[status].label.toLowerCase()}` : ""}
      </p>
      <FormError>{error}</FormError>

      {gated && findings && findings.vulns.length > 0 && (
        <section className="grid gap-2" aria-labelledby="findings-heading">
          <h3 id="findings-heading" className="text-sm font-semibold">
            Critical and High findings
          </h3>
          <VulnList tag="this image" name={name} summary={findings.summary} vulns={findings.vulns} error={findings.error} canRescan={false} />
        </section>
      )}

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
        <Fact label="Trigger">{TRIGGER_LABEL[build.trigger]}</Fact>
        <Fact label="Commit">{build.commit ? <code className="font-mono">{build.commit.slice(0, 12)}</code> : "Not known yet"}</Fact>
        <Fact label="Started by">{build.who ?? "A push or schedule"}</Fact>
        <Fact label="Queued">
          <span suppressHydrationWarning title={WHEN.format(new Date(build.createdAt))}>
            {ago(build.createdAt)}
          </span>
        </Fact>
        {(build.ruleSummary || build.trigger === "cli" || build.trigger === "upload") && (
          <Fact label="Rule">{build.ruleSummary ?? "None (uploaded archive)"}</Fact>
        )}
        <Fact label="Digest">
          {build.digest ? (
            <span className="flex items-center gap-2">
              <code className="min-w-0 truncate font-mono text-xs" title={build.digest}>
                {build.digest.slice(0, 19)}…
              </code>
              <CopyButton value={build.digest} label="Copy the digest" className={TOUCH} />
            </span>
          ) : (
            "Not pushed"
          )}
        </Fact>
      </dl>

      {build.tags.length > 0 && (
        <section className="grid gap-2" aria-labelledby="tags-heading">
          <h3 id="tags-heading" className="text-sm font-semibold">
            {status === "success" ? "Tags produced" : "Tags it will get"}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {build.tags.map((t) =>
              status === "success" ? (
                <Link key={t} href={`/registry/${name}?tab=tags&tag=${encodeURIComponent(t)}`} className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center">
                  <Badge variant="outline" className="font-mono hover:bg-accent">
                    {t}
                  </Badge>
                </Link>
              ) : (
                <Badge key={t} variant="outline" className="font-mono">
                  {t}
                </Badge>
              )
            )}
          </div>
        </section>
      )}

      <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2" aria-labelledby="log-heading">
        <h3 id="log-heading" className="text-sm font-semibold">
          Log
        </h3>
        <LogViewer
          lines={lines}
          live={active}
          truncated={finished && !full && lines.length >= TAIL_LINES}
          loadingFull={loadingFull}
          onLoadFull={async () => {
            setLoadingFull(true)
            const text = await fullBuildLog(build.id).catch(() => null)
            setLoadingFull(false)
            if (text === null) return setNotice({ text: "Couldn't load the full log." })
            setLines(text.split("\n"))
            setFull(true)
          }}
          filename={`build-${build.id.slice(0, 8)}.log`}
        />
      </section>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-1 bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm font-medium break-words">{children}</dd>
    </div>
  )
}

function Attach({ label }: { label: string }) {
  return (
    <Badge variant="outline">
      <CheckIcon aria-hidden weight="bold" className="text-brand" />
      {label}
    </Badge>
  )
}

function PullLine({ value, label }: { value: string; label: string }) {
  return (
    <div className="relative">
      <Code copy>{value}</Code>
      <div className="absolute top-2 right-2">
        <CopyButton value={value} label={label} className={TOUCH} />
      </div>
    </div>
  )
}
