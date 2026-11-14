"use client"

import { DesktopTowerIcon, DownloadSimpleIcon } from "@phosphor-icons/react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { api, errorText } from "@/components/secrets/client"
import { Confirm } from "@/components/secrets/ui"
import { Button } from "@/components/ui/button"

type Device = { deviceName: string; ip: string | null; status: string } | null
type Tok = { id: string; name: string; createdAt: string; lastUsedAt: string | null; lastIp: string | null }
type Bin = { name: string; os: string; arch: string; size: number }

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
const OS: Record<string, string> = { linux: "Linux", darwin: "macOS", windows: "Windows", node: "Node.js" }
const size = (b: number) => (b < 1048576 ? `${Math.ceil(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`)

// Approve a `nimbus login` (the page opens here with ?code=).
export function ApproveBox({ code, device }: { code: string; device: Device }) {
  const router = useRouter()
  const [answer, setAnswer] = useState<"approved" | "denied" | null>(null)
  const [error, setError] = useState<string | null>(null)

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
  )
}

// The Node CLI and Go builds this server has.
export function Downloads({ binaries }: { binaries: Bin[] }) {
  if (!binaries.length)
    return (
      <p className="rounded-lg border border-dashed px-3 py-3 text-muted-foreground">
        No CLI builds are on this server yet. The Docker image includes them; from a checkout, run{" "}
        <code>npm run cli:build</code> (needs Docker for the Go builds) and they appear here.
      </p>
    )
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Downloads">
      {binaries.map((b) => (
        <li key={b.name}>
          <a
            href={`/api/v1/secrets/cli/download/${b.name}`}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm no-underline hover:bg-muted/50"
          >
            <DownloadSimpleIcon className="size-4 shrink-0" />
            <span className="flex-1">{OS[b.os] ?? b.os} · {b.arch}</span>
            <span className="text-xs text-muted-foreground">{size(b.size)}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

// Devices where `nimbus login` is signed in as you.
export function Devices({ tokens }: { tokens: Tok[] }) {
  const router = useRouter()
  const [drop, setDrop] = useState<Tok | null>(null)
  return (
    <section className="flex flex-col gap-2" aria-label="Signed-in devices">
      <h4 className="text-sm font-semibold">Signed-in devices</h4>
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
    </section>
  )
}
