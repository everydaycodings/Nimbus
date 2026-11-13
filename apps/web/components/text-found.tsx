"use client"

import { CheckIcon, CopyIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import type { FileTextStatus } from "@nimbus/shared/api"
import { Button } from "@/components/ui/button"

const LABEL = (s: FileTextStatus) =>
  s.state === "done"
    ? "Read"
    : s.state === "waiting"
      ? "Waiting to be read"
      : s.state === "failed"
        ? `Couldn't read${s.failed ? `: ${s.failed}` : ""}`
        : s.state === "off"
          ? "Text reading is off"
          : "No text found"

// Details › "Text found": whether Nimbus has read the words in an image, PDF or video,
// the first part of them, and (for the owner) a way to read them again.
export function TextFound({ id }: { id: string }) {
  const [loaded, setLoaded] = useState<{ id: string; status: FileTextStatus | null } | null>(null)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const status = loaded?.id === id ? loaded.status : undefined

  useEffect(() => {
    let live = true
    fetch(`/api/v1/files/${id}/text`)
      .then((r) => (r.ok ? (r.json() as Promise<FileTextStatus>) : null))
      .catch(() => null)
      .then((s) => live && setLoaded({ id, status: s }))
    return () => {
      live = false
    }
  }, [id])

  async function reread() {
    setError("")
    try {
      const r = await fetch(`/api/v1/files/${id}/reread`, { method: "POST" })
      if (!r.ok) throw new Error()
      setLoaded({ id, status: { state: "waiting", preview: "", canReread: false } })
    } catch {
      setError("Couldn't ask for a re-read. Try again.")
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(status!.preview)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  if (status === null) return null
  return (
    <section aria-labelledby="text-found-heading" className="flex flex-col gap-2">
      <h3 id="text-found-heading" className="text-sm font-medium">
        Text found
      </h3>
      {status === undefined ? (
        <span className="h-4 w-24 animate-pulse rounded bg-muted/60 motion-reduce:animate-none" />
      ) : (
        <>
          <p
            className={
              status.state === "failed" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
            }
            aria-live="polite"
          >
            {LABEL(status)}
            {status.state === "done" && status.readAt && (
              <span suppressHydrationWarning>
                {" "}
                · {new Date(status.readAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
              </span>
            )}
          </p>
          {status.state === "done" && status.preview && (
            <details className="group rounded-lg border bg-muted/30">
              <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                Preview
                <span aria-hidden className="ml-auto text-xs text-muted-foreground group-open:hidden">
                  Show
                </span>
                <span aria-hidden className="ml-auto hidden text-xs text-muted-foreground group-open:inline">
                  Hide
                </span>
              </summary>
              <div className="flex flex-col gap-2 border-t p-3">
                <pre className="max-h-48 overflow-y-auto font-sans text-xs break-words whitespace-pre-wrap text-muted-foreground">
                  {status.preview}
                </pre>
                <Button variant="outline" size="xs" className="self-start" onClick={copy}>
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </details>
          )}
          {status.canReread && (
            <Button variant="outline" size="sm" className="self-start" onClick={reread}>
              Read text again
            </Button>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
    </section>
  )
}
