"use client"

import {
  MusicNoteIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RepeatOnceIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useEffect } from "react"

import { CastButton, ResumePrompt, SleepMenu, SpeedMenu } from "@/components/player-controls"
import { Thumb } from "@/components/thumb"
import { CurrentLine } from "@/components/transcript"
import {
  audioCast,
  audioCurrent,
  audioJump,
  audioNext,
  audioPlay,
  audioPrev,
  audioRepeat,
  audioSeek,
  audioShuffle,
  audioSleep,
  audioSpeed,
  audioStop,
  audioStore,
  audioToggle,
  audioView,
} from "@/lib/audio-store"
import { useCastButton } from "@/lib/cast"
import { fileType } from "@/lib/file-types"
import type { Item } from "@/lib/files"
import { useStore } from "@/lib/media-extras"
import { clock } from "@/lib/player-rules"
import { cn } from "@/lib/utils"

const ROUND =
  "grid size-9 shrink-0 place-items-center rounded-full outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40 [&_svg]:size-5"
const PILL =
  "flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-medium tabular-nums outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-5"

const title = (it: Item) => it.name.replace(/\.[^.]+$/, "")

function Scrub({ className }: { className?: string }) {
  const { time, duration } = useStore(audioStore)
  const pct = duration ? (time / duration) * 100 : 0
  return (
    <input
      type="range"
      aria-label="Seek"
      aria-valuetext={`${clock(time)} of ${clock(duration)}`}
      min={0}
      max={duration || 0}
      step={0.1}
      value={Math.min(time, duration || 0)}
      onChange={(e) => audioSeek(Number(e.target.value))}
      style={{ "--p": `${pct}%` } as React.CSSProperties}
      className={cn(
        "h-1 w-full cursor-pointer appearance-none rounded-full bg-[linear-gradient(to_right,var(--brand)_var(--p),var(--muted)_var(--p))] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground",
        className
      )}
    />
  )
}

// The previewer's audio file: the folder's audio files become the queue. The player itself
// lives in lib/audio-store.ts, so closing the previewer leaves it playing in the mini-player.
export function AudioView({
  item,
  queue,
  url,
  ephemeral,
}: {
  item: Item
  // The folder's audio files, in order.
  queue?: Item[]
  // A URL for `item` that the previewer already fetched.
  url: string
  // Vault and public-link audio: decrypted or link-bound, so it stops with the view.
  ephemeral?: boolean
}) {
  const s = useStore(audioStore)
  const castable = useCastButton() && !ephemeral
  useEffect(() => {
    audioView(1)
    if (ephemeral || audioCurrent()?.id !== item.id) {
      const list = queue?.some((q) => q.id === item.id) ? queue : [item]
      audioPlay(list, list.findIndex((q) => q.id === item.id), { url, ephemeral })
    }
    return () => {
      audioView(-1)
      if (ephemeral) audioStop()
    }
    // Only a different file restarts it; the queue and URL are what that file arrived with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  const now = audioCurrent() ?? item
  const t = fileType("file", now.mime, now.name)
  const many = s.tracks.length > 1
  return (
    <div className="m-auto flex max-h-full w-full max-w-md flex-col items-center gap-6 overflow-y-auto p-1">
      {/* Fully hides the page behind it: black, with the cover art blurred and dimmed over it. */}
      <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden bg-neutral-950">
        {s.cover && (
          // eslint-disable-next-line @next/next/no-img-element -- a blob URL of the embedded art
          <img src={s.cover} alt="" className="size-full scale-125 object-cover opacity-30 blur-3xl" />
        )}
      </div>
      {s.cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- a blob URL of the embedded art
        <img src={s.cover} alt="" className="aspect-square w-64 rounded-2xl border object-cover shadow-2xl sm:w-72" />
      ) : (
        <Thumb
          item={now}
          make={false}
          className="grid aspect-square w-64 place-items-center rounded-2xl border bg-card shadow-2xl sm:w-72"
        >
          <t.icon weight="duotone" className={cn("size-24", t.color)} />
        </Thumb>
      )}
      <div className="w-full text-center">
        <p className="truncate text-xl font-semibold tracking-tight" title={now.name}>
          {title(now)}
        </p>
        {s.error ? (
          <p className="mt-1 flex items-center justify-center gap-1 text-sm text-destructive">
            <WarningCircleIcon /> {s.error}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">
            {many ? `Track ${s.order.indexOf(s.tracks.indexOf(now)) + 1} of ${s.tracks.length}` : "Audio"}
          </p>
        )}
        {!ephemeral && <CurrentLine id={now.id} />}
      </div>

      {s.resume && <ResumePrompt resume={s.resume} className="self-center" />}
      <div className="flex w-full flex-col gap-1.5">
        {s.resume && <ResumePrompt resume={s.resume} className="self-center" />}
        <Scrub />
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{clock(s.time)}</span>
          <span>{clock(s.duration)}</span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button type="button" className={cn(ROUND, s.shuffle && "text-brand")} aria-label="Shuffle" aria-pressed={s.shuffle} title="Shuffle" disabled={!many} onClick={audioShuffle}>
          <ShuffleIcon />
        </button>
        <button type="button" className={ROUND} aria-label="Previous track" title="Previous" onClick={audioPrev}>
          <SkipBackIcon weight="fill" />
        </button>
        <button
          type="button"
          aria-label={s.playing ? "Pause" : "Play"}
          title={s.playing ? "Pause" : "Play"}
          onClick={audioToggle}
          className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-6"
        >
          {s.playing ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" className="ml-0.5" />}
        </button>
        <button type="button" className={ROUND} aria-label="Next track" title="Next" disabled={!many} onClick={audioNext}>
          <SkipForwardIcon weight="fill" />
        </button>
        <button
          type="button"
          className={cn(ROUND, s.repeat !== "off" && "text-brand")}
          aria-label={`Repeat: ${s.repeat}`}
          title={`Repeat: ${s.repeat}`}
          onClick={audioRepeat}
        >
          {s.repeat === "one" ? <RepeatOnceIcon /> : <RepeatIcon />}
        </button>
      </div>

      <div className="flex items-center gap-1">
        <SpeedMenu speed={s.speed} onChange={audioSpeed} className={PILL} />
        <SleepMenu timer={audioSleep} endLabel="End of track" className={PILL} />
        {castable && <CastButton onClick={audioCast} active={s.casting} className={ROUND} />}
      </div>

      {many && (
        <section aria-label="Queue" className="w-full">
          <h2 className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">Up next</h2>
          <ol className="max-h-56 overflow-y-auto rounded-xl border bg-card p-1">
            {s.order.map((n, i) => {
              const it = s.tracks[n]
              const now = i === s.pos
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => audioJump(n)}
                    aria-current={now}
                    className={cn(
                      "flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      now && "bg-accent font-medium"
                    )}
                  >
                    <span className="grid w-5 shrink-0 place-items-center text-xs text-muted-foreground tabular-nums">
                      {now ? <MusicNoteIcon weight="fill" className="size-4 text-brand" /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{title(it)}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}

// Stays at the bottom of the app while audio plays and the previewer is closed.
export function MiniPlayer() {
  const s = useStore(audioStore)
  const it = audioCurrent()
  if (!it || s.viewing > 0) return null
  return (
    <div
      role="region"
      aria-label="Audio player"
      className="pointer-events-auto flex w-full flex-col gap-1 rounded-xl border bg-popover p-2 pl-3 text-popover-foreground shadow-xl"
    >
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={it.name}>
            {title(it)}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {s.error ?? `${clock(s.time)} / ${clock(s.duration)}`}
          </p>
        </div>
        <button type="button" className={ROUND} aria-label="Previous track" onClick={audioPrev}>
          <SkipBackIcon weight="fill" />
        </button>
        <button
          type="button"
          className={cn(ROUND, "bg-primary text-primary-foreground hover:bg-primary/90")}
          aria-label={s.playing ? "Pause" : "Play"}
          onClick={audioToggle}
        >
          {s.playing ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" className="ml-0.5" />}
        </button>
        <button type="button" className={ROUND} aria-label="Next track" disabled={s.tracks.length < 2} onClick={audioNext}>
          <SkipForwardIcon weight="fill" />
        </button>
        <SleepMenu timer={audioSleep} endLabel="End of track" className={cn(PILL, "max-sm:hidden")} />
        <button type="button" className={ROUND} aria-label="Close player" title="Close player" onClick={audioStop}>
          <XIcon />
        </button>
      </div>
      {s.resume && <ResumePrompt resume={s.resume} className="self-center" />}
      <Scrub />
    </div>
  )
}
