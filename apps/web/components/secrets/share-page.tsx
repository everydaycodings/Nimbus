"use client"

import { CheckIcon, CloudIcon, CopyIcon, EyeIcon, FireIcon, LinkBreakIcon, LockSimpleIcon } from "@phosphor-icons/react"
import Link from "next/link"
import { useState } from "react"

import { SubmitButton } from "@/components/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Meta = { ok: false } | { ok: true; label: string | null; password: boolean; expiresAt: string; viewsLeft: number }

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

// /s/ns_…: a one-time secret. Nothing is fetched until the visitor clicks Reveal,
// and the last view burns the link.
export function SharePage({ token, meta }: { token: string; meta: Meta }) {
  const [password, setPassword] = useState("")
  const [text, setText] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gone, setGone] = useState(!meta.ok)
  const [copied, setCopied] = useState(false)

  async function reveal() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/secret-share/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; text?: string; viewsLeft?: number; error?: string; message?: string }
      if (res.ok && data.ok && data.text !== undefined) {
        setText(data.text)
        setLeft(data.viewsLeft ?? 0)
      } else if (data.error === "password") setError("That password isn't right.")
      else if (res.status === 429) setError(data.message ?? "Too many tries. Wait a minute.")
      else setGone(true)
    } catch {
      setError("Couldn't reach the server. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-14 items-center gap-3 border-b px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-md text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <CloudIcon weight="fill" className="size-5 text-brand" />
          Nimbus
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 p-4 py-12 sm:p-6">
        {text !== null ? (
          <>
            <div className="grid gap-1">
              <h1 className="text-xl font-semibold tracking-tight">{meta.ok && meta.label ? meta.label : "Shared with you"}</h1>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
                <FireIcon className="size-4 text-warning" />
                {left > 0 ? `${left} more view${left === 1 ? "" : "s"} left.` : "This link has burned. Copy what you need now."}
              </p>
            </div>
            <pre aria-label="The shared text" className="max-h-80 overflow-auto rounded-xl border bg-muted/30 px-4 py-3 font-mono text-sm break-all whitespace-pre-wrap">{text}</pre>
            <Button
              variant="outline"
              className="w-fit"
              onClick={async () => {
                await navigator.clipboard.writeText(text).catch(() => {})
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </>
        ) : gone || !meta.ok ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <LinkBreakIcon className="size-10 text-muted-foreground" />
            <h1 className="text-lg font-semibold">This link doesn&apos;t work</h1>
            <p className="max-w-sm text-sm text-pretty text-muted-foreground">
              It may have been viewed already, expired, or been revoked. Ask the person who sent it for a new one.
            </p>
          </div>
        ) : (
          <form
            className="flex flex-col gap-5 rounded-xl border bg-card p-6"
            onSubmit={(e) => {
              e.preventDefault()
              reveal()
            }}
          >
            <span className="grid size-10 place-items-center rounded-full bg-muted">
              {meta.password ? <LockSimpleIcon className="size-5" /> : <EyeIcon className="size-5" />}
            </span>
            <div className="grid gap-1">
              <h1 className="text-lg font-semibold tracking-tight">{meta.label ?? "Someone shared a secret with you"}</h1>
              <p className="text-sm text-pretty text-muted-foreground">
                It opens once you click, and it can be opened {meta.viewsLeft} more time{meta.viewsLeft === 1 ? "" : "s"}. Then it&apos;s gone. Expires {when.format(new Date(meta.expiresAt))}.
              </p>
            </div>
            {meta.password && (
              <div className="grid gap-2">
                <Label htmlFor="share-password">Password</Label>
                <Input id="share-password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              </div>
            )}
            <p role="alert" className="text-sm text-destructive empty:hidden">{error}</p>
            <SubmitButton pending={busy} disabled={meta.password && !password}>
              Reveal
            </SubmitButton>
          </form>
        )}
      </main>
    </div>
  )
}
