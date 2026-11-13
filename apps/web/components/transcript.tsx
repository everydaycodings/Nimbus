"use client"

import { DownloadSimpleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react"
import { Fragment, useEffect, useMemo, useState } from "react"

import { getTranscript, redoTranscript } from "@/app/(app)/people-actions"
import { clock } from "@/components/text-places"
import { Button } from "@/components/ui/button"
import { useAi } from "@/components/ai-context"
import { audioStore } from "@/lib/audio-store"
import { useStore } from "@/lib/media-extras"
import type { TranscriptLine, TranscriptResponse } from "@nimbus/shared/api"

// null: no transcript for this file (or not one I can see); undefined: still loading.
export function useTranscript(id: string, enabled = true) {
  const [loaded, setLoaded] = useState<{ id: string; t: TranscriptResponse | null } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    getTranscript(id).then(
      (t) => live && setLoaded({ id, t }),
      () => live && setLoaded({ id, t: null })
    )
    return () => {
      live = false
    }
  }, [id, enabled])
  const t = loaded?.id === id ? loaded.t : undefined
  return [enabled ? t : null, (v: TranscriptResponse) => setLoaded({ id, t: v })] as const
}

const language = (code: string | null) => {
  if (!code) return null
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function Marked({ text, q }: { text: string; q: string }) {
  if (!q) return text
  return text.split(new RegExp(`(${esc(q)})`, "i")).map((part, i) => (
    <Fragment key={i}>
      {i % 2 ? <mark className="rounded-sm bg-brand/20 text-foreground">{part}</mark> : part}
    </Fragment>
  ))
}

// The line being said at `ms`: the last one that started, until the next begins (or 8 s with no end).
export function lineAt(lines: TranscriptLine[], ms: number) {
  let hit: TranscriptLine | null = null
  for (const l of lines) {
    if (l.tMs > ms) break
    hit = l
  }
  return hit && ms < (hit.endMs ?? hit.tMs + 8000) ? hit : null
}

// Details › Transcript: what was said, with the language, a find box, and downloads.
// Clicking a line calls `onSeek` with its time.
export function Transcript({ id, onSeek }: { id: string; onSeek?: (tMs: number) => void }) {
  const on = useAi().speech
  const [t, setT] = useTranscript(id, on)
  const [q, setQ] = useState("")
  const [error, setError] = useState("")
  const needle = q.trim()
  const shown = useMemo(
    () => (t?.lines ?? []).filter((l) => !needle || l.text.toLowerCase().includes(needle.toLowerCase())),
    [t, needle]
  )

  async function redo() {
    setError("")
    if (!(await redoTranscript(id).catch(() => false))) return setError("Couldn't ask for it again. Try again.")
    setT({ state: "waiting", lang: null, lines: [], canRedo: false })
  }

  if (!on || t === null) return null
  const lang = language(t?.lang ?? null)
  return (
    <section aria-labelledby="transcript-heading" className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 id="transcript-heading" className="text-sm font-medium">
          Transcript
        </h3>
        {lang && t?.state === "done" && <span className="text-xs text-muted-foreground">{lang}</span>}
      </div>
      {t === undefined ? (
        <span className="h-4 w-24 animate-pulse rounded bg-muted/60 motion-reduce:animate-none" />
      ) : t.state !== "done" ? (
        <p className={t.state === "failed" ? "text-sm text-destructive" : "text-sm text-muted-foreground"} aria-live="polite">
          {t.state === "waiting"
            ? "Waiting to be transcribed."
            : t.state === "none"
              ? "No speech found."
              : t.state === "failed"
                ? `Couldn't transcribe${t.failed ? `: ${t.failed}` : ""}.`
                : "Transcripts are off for this file."}
        </p>
      ) : (
        <>
          <label className="relative block">
            <span className="sr-only">Find in transcript</span>
            <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find in transcript"
              className="h-8 w-full rounded-md border border-input bg-transparent pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </label>
          <ol
            aria-label="Transcript lines"
            className="flex max-h-64 flex-col overflow-y-auto rounded-lg border bg-muted/30 p-1"
          >
            {shown.map((l, i) => {
              const body = (
                <>
                  <span className="mt-px shrink-0 rounded bg-muted px-1.5 py-px text-xs font-medium text-foreground tabular-nums">
                    {clock(l.tMs)}
                  </span>
                  <span className="min-w-0 text-sm break-words">
                    <Marked text={l.text} q={needle} />
                  </span>
                </>
              )
              return (
                <li key={`${l.tMs}-${i}`}>
                  {onSeek ? (
                    <button
                      type="button"
                      onClick={() => onSeek(l.tMs)}
                      aria-label={`${clock(l.tMs)}: ${l.text}`}
                      className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 pointer-coarse:py-2 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2 px-1.5 py-1">{body}</div>
                  )}
                </li>
              )
            })}
            {!shown.length && <li className="px-2 py-3 text-sm text-muted-foreground">Nothing matches “{needle}”.</li>}
          </ol>
          <div className="flex flex-wrap gap-2">
            {(["srt", "txt"] as const).map((f) => (
              <a
                key={f}
                href={`/api/v1/files/${id}/transcript?format=${f}`}
                download
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-input dark:bg-input/30"
              >
                <DownloadSimpleIcon className="size-3.5" />
                .{f}
              </a>
            ))}
          </div>
        </>
      )}
      {t?.canRedo && t.state !== "waiting" && (
        <Button variant="outline" size="sm" className="self-start" onClick={redo}>
          Transcribe again
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  )
}

// Audio player: the line being said, under the title. Nothing without a transcript.
export function CurrentLine({ id }: { id: string }) {
  const on = useAi().speech
  const [t] = useTranscript(id, on)
  const { time } = useStore(audioStore)
  const line = t?.state === "done" ? lineAt(t.lines, time * 1000) : null
  if (t?.state !== "done") return null
  return (
    <p
      aria-label="Spoken now"
      className="mt-2 min-h-10 text-sm text-pretty text-foreground/80 [display:-webkit-box] overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
    >
      {line?.text ?? ""}
    </p>
  )
}
