"use client"

import { ArrowLeftIcon, CheckCircleIcon, CopyIcon, DesktopTowerIcon, DownloadSimpleIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { api, errorText } from "@/components/secrets/client"
import { Confirm } from "@/components/secrets/ui"
import { Button } from "@/components/ui/button"

type Device = { deviceName: string; ip: string | null; status: string } | null
type Tok = { id: string; name: string; createdAt: string; lastUsedAt: string | null; lastIp: string | null }
type Bin = { name: string; os: string; arch: string; size: number }

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
const OS: Record<string, string> = { linux: "Linux", darwin: "macOS", windows: "Windows" }

function Snippet({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md border bg-muted/50 py-1.5 pr-1.5 pl-3">
      <pre className="min-w-0 flex-1 overflow-x-auto py-1 font-mono text-xs leading-relaxed" aria-label={label}>{text}</pre>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy ${label}`}
        onClick={() => navigator.clipboard.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}
      >
        {done ? <CheckCircleIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}

// The CLI page: approve a `nimbus login`, install the CLI, and see signed-in devices.
export function CliPanel({
  enabled,
  server,
  binaries,
  tokens,
  code,
  device,
}: {
  enabled: boolean
  server: string
  binaries: Bin[]
  tokens: Tok[]
  code: string | null
  device: Device
}) {
  const router = useRouter()
  const [answer, setAnswer] = useState<"approved" | "denied" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drop, setDrop] = useState<Tok | null>(null)

  async function reply(allow: boolean) {
    setError(null)
    try {
      await api("/auth/device/approve", "POST", { code, allow })
      setAnswer(allow ? "approved" : "denied")
      router.refresh()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-8 [&_section]:min-w-0 [&_section>div>div]:min-w-0">
      <div className="flex flex-col gap-2">
        <Link href="/secrets" className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-3.5" />
          All projects
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Command line</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Run apps with their secrets, export a .env, or keep a file on a server up to date with <code className="font-mono">nimbus agent</code>.
        </p>
      </div>

      {!enabled && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          An admin turned the command line off on this server. Sign-ins and downloads are paused.
        </p>
      )}

      {code && enabled && (
        <section aria-label="Approve sign-in" className="flex flex-col gap-3 rounded-xl border bg-card p-5">
          {answer ? (
            <p role="status" className="text-sm">
              {answer === "approved" ? "Approved. Your terminal signs in within a few seconds." : "Refused. The terminal won't be signed in."}
            </p>
          ) : device?.status === "pending" ? (
            <>
              <h2 className="text-base font-semibold">Sign in the command line?</h2>
              <p className="text-sm text-pretty text-muted-foreground">
                A terminal on <strong className="text-foreground">{device.deviceName}</strong>
                {device.ip ? ` (${device.ip})` : ""} asked to act as you in Secrets. Check that this code is the one it shows:
              </p>
              <p className="font-mono text-2xl tracking-widest" data-testid="device-code">{code.toUpperCase()}</p>
              <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
              <div className="flex gap-2">
                <Button onClick={() => reply(true)}>Approve</Button>
                <Button variant="outline" onClick={() => reply(false)}>Refuse</Button>
              </div>
            </>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {device ? "That code was already answered or has expired." : "That code isn't valid."} Run <code className="font-mono">nimbus login</code> again for a new one.
            </p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3" aria-label="Install">
        <h2 className="text-base font-semibold">Install</h2>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
            <h3 className="text-sm font-medium">With Node 20+ (npm)</h3>
            <Snippet label="npm install" text={`npm install -g @nimbus/cli\n# or without installing\nnpx @nimbus/cli login --server ${server}`} />
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
            <h3 className="text-sm font-medium">Single binary (Go)</h3>
            {binaries.length ? (
              <ul className="grid gap-1 sm:grid-cols-2">
                {binaries.map((b) => (
                  <li key={b.name}>
                    <a
                      href={`/api/v1/secrets/cli/download/${b.name}`}
                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
                    >
                      <DownloadSimpleIcon className="size-4 shrink-0" />
                      <span className="flex-1">{OS[b.os] ?? b.os} · {b.arch}</span>
                      <span className="text-xs text-muted-foreground">{(b.size / 1048576).toFixed(1)} MB</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <p className="text-sm text-pretty text-muted-foreground">
                  No binaries are on this server yet. Build them from the repository (Go 1.22+), and they appear here:
                </p>
                <Snippet label="build instructions" text={"cd packages/cli-go && make   # writes dist/nimbus-<os>-<arch>"} />
              </>
            )}
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
            <h3 className="text-sm font-medium">Shell script (bash and curl, nothing to install)</h3>
            <Snippet
              label="curl one-liner"
              text={`curl -fsSL ${server}/api/v1/secrets/cli/nimbus.sh | NIMBUS_SERVER=${server} NIMBUS_TOKEN=nms_… bash -s -- run --project web --env prod -- ./start.sh`}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-label="Quick start">
        <h2 className="text-base font-semibold">Quick start</h2>
        <Snippet
          label="quick start"
          text={`nimbus login --server ${server}\nnimbus run --project web --env dev -- npm start\nnimbus export --project web --env prod --format dotenv > .env\nnimbus agent --project web --env prod --out /srv/app/.env --on-change "systemctl restart app"`}
        />
        <p className="text-sm text-pretty text-muted-foreground">
          Servers and CI use a machine token instead of <code className="font-mono">login</code>: make one under a project&apos;s Access tab and set <code className="font-mono">NIMBUS_TOKEN</code>.
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-label="Signed-in devices">
        <h2 className="text-base font-semibold">Signed-in devices</h2>
        {tokens.length ? (
          <ul className="flex flex-col divide-y rounded-xl border">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <DesktopTowerIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Signed in {when(t.createdAt)} · {t.lastUsedAt ? `last used ${when(t.lastUsedAt)}${t.lastIp ? ` from ${t.lastIp}` : ""}` : "never used"}
                  </p>
                </div>
                <Button variant="outline" size="sm" aria-label={`Sign out ${t.name}`} onClick={() => setDrop(t)}>
                  Sign out
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No command line is signed in as you.</p>
        )}
      </section>
      {drop && (
        <Confirm
          title={`Sign out ${drop.name}?`}
          description="Its token stops working at once. It can sign in again with nimbus login."
          action="Sign out"
          danger
          run={async () => {
            await api(`/cli/tokens/${drop.id}`, "DELETE")
            router.refresh()
          }}
          onClose={() => setDrop(null)}
        />
      )}
    </div>
  )
}
