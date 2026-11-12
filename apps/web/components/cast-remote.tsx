"use client"

import { Menu } from "@base-ui/react/menu"
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CheckIcon,
  CircleNotchIcon,
  PauseIcon,
  PlayIcon,
  ScreencastIcon,
  SkipForwardIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  SubtitlesIcon,
} from "@phosphor-icons/react"
import { useState } from "react"

import { MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import {
  castHasNext,
  castMute,
  castNext,
  castSeek,
  castSkip,
  castStop,
  castStore,
  castToggle,
  castTracks,
  castVolume,
  type CastTrack,
} from "@/lib/cast"
import { makeCopy, useStore } from "@/lib/media-extras"
import { clock } from "@/lib/player-rules"
import { cn } from "@/lib/utils"

const BTN =
  "grid size-9 shrink-0 place-items-center rounded-full outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40 [&_svg]:size-5"

function TrackMenu({
  icon,
  label,
  tracks,
  active,
  off,
  onPick,
}: {
  icon: React.ReactNode
  label: string
  tracks: CastTrack[]
  active: number | null
  // Subtitles can be turned off; an audio track can't.
  off?: boolean
  onPick: (id: number | null) => void
}) {
  return (
    <Menu.Root>
      <Menu.Trigger className={BTN} aria-label={label} title={label}>
        {icon}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="end" sideOffset={8} className="z-[80]">
          <Menu.Popup className={cn("w-48", MENU_POPUP)}>
            {off && (
              <Menu.Item className={MENU_ITEM} onClick={() => onPick(null)}>
                Off
                {active === null && <CheckIcon className="ml-auto" />}
              </Menu.Item>
            )}
            {tracks.map((t) => (
              <Menu.Item key={t.id} className={MENU_ITEM} onClick={() => onPick(t.id)}>
                <span className="truncate">{t.label}</span>
                {active === t.id && <CheckIcon className="ml-auto" />}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

// The remote shown while a TV is connected: what it plays, with the controls to run it.
export function CastRemote() {
  const s = useStore(castStore)
  // Make copy: null, "asking", "queued", or the reason it was refused.
  const [copy, setCopy] = useState<string | null>(null)
  if (!s.connected) return null
  const it = s.loaded
  const timed = it && it.kind !== "image" && !s.problem
  const makeIt = async () => {
    setCopy("asking")
    setCopy((await makeCopy(it!.id)) ?? "queued")
  }
  const note =
    copy === "queued"
      ? "Making a data-saver copy. Cast it again in a few minutes."
      : copy && copy !== "asking"
        ? copy
        : s.problem?.message
  return (
    <div
      role="region"
      aria-label={`Casting to ${s.device || "a TV"}`}
      className="pointer-events-auto flex w-full flex-col gap-1 rounded-xl border bg-popover p-2 pl-3 text-popover-foreground shadow-xl"
    >
      <div className="flex items-center gap-2">
        <ScreencastIcon weight="fill" className="size-5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={it?.name}>
            {it?.name ?? "Connected"}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {s.busy ? "Sending to " : "Casting to "}
            {s.device || "your TV"}
          </p>
        </div>
        <button
          type="button"
          onClick={castStop}
          className="h-8 shrink-0 rounded-full border px-3 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Stop casting
        </button>
      </div>

      {s.problem && (
        <div className="flex items-center gap-2 py-1 text-sm">
          <span role="status" className="min-w-0 flex-1">{note}</span>
          {s.problem.canMakeCopy && copy !== "queued" && (
            <button
              type="button"
              disabled={copy === "asking"}
              onClick={makeIt}
              className="h-8 shrink-0 rounded-full bg-primary px-3 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            >
              {copy === "asking" ? "Asking…" : "Make copy"}
            </button>
          )}
        </div>
      )}

      {timed && (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
            <span className="w-10 text-right">{clock(s.time)}</span>
            <input
              type="range"
              aria-label="Seek on the TV"
              min={0}
              max={s.duration || 0}
              step={1}
              value={Math.min(s.time, s.duration || 0)}
              onChange={(e) => castSeek(Number(e.target.value))}
              style={{ "--p": `${s.duration ? (s.time / s.duration) * 100 : 0}%` } as React.CSSProperties}
              className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-[linear-gradient(to_right,var(--brand)_var(--p),var(--muted)_var(--p))] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
            />
            <span className="w-10">{clock(s.duration)}</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1">
            <button type="button" className={BTN} aria-label="Back 10 seconds" title="Back 10 s" onClick={() => castSkip(-10)}>
              <ArrowCounterClockwiseIcon />
            </button>
            <button
              type="button"
              className={cn(BTN, "size-10 bg-primary text-primary-foreground hover:bg-primary/90")}
              aria-label={s.playing ? "Pause" : "Play"}
              onClick={castToggle}
            >
              {s.busy ? (
                <CircleNotchIcon className="animate-spin motion-reduce:animate-none" />
              ) : s.playing ? (
                <PauseIcon weight="fill" />
              ) : (
                <PlayIcon weight="fill" className="ml-0.5" />
              )}
            </button>
            <button type="button" className={BTN} aria-label="Forward 10 seconds" title="Forward 10 s" onClick={() => castSkip(10)}>
              <ArrowClockwiseIcon />
            </button>
            {castHasNext() && (
              <button type="button" className={BTN} aria-label="Next" title="Next" onClick={castNext}>
                <SkipForwardIcon weight="fill" />
              </button>
            )}
            <span className="mx-1 h-5 w-px bg-border" />
            <button type="button" className={BTN} aria-label={s.muted ? "Unmute TV" : "Mute TV"} onClick={castMute}>
              {s.muted ? <SpeakerSlashIcon /> : <SpeakerHighIcon />}
            </button>
            <input
              type="range"
              aria-label="TV volume"
              min={0}
              max={1}
              step={0.05}
              value={s.muted ? 0 : s.volume}
              onChange={(e) => castVolume(Number(e.target.value))}
              className="h-1 w-20 cursor-pointer accent-foreground max-sm:w-14"
            />
            {s.subtitles.length > 0 && (
              <TrackMenu
                icon={<SubtitlesIcon />}
                label="Subtitles"
                tracks={s.subtitles}
                active={s.activeSubtitle}
                off
                onPick={(id) => castTracks(id, null)}
              />
            )}
            {s.audioTracks.length > 1 && (
              <TrackMenu
                icon={<SpeakerHighIcon />}
                label="Audio track"
                tracks={s.audioTracks}
                active={s.activeAudio}
                onPick={(id) => castTracks(s.activeSubtitle, id)}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
