"use client"

import { Menu } from "@base-ui/react/menu"
import {
  CheckIcon,
  CircleNotchIcon,
  CornersInIcon,
  CornersOutIcon,
  ImageSquareIcon,
  PauseIcon,
  PictureInPictureIcon,
  PlayIcon,
  SpeakerHighIcon,
  SpeakerLowIcon,
  SpeakerSlashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import { MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import { cn } from "@/lib/utils"

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const VOLUME_KEY = "nimbus_volume"
const HIDE_AFTER = 2500

function clock(s: number) {
  if (!Number.isFinite(s)) return "0:00"
  const t = Math.floor(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

function savedVolume() {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY))
    return v > 0 && v <= 1 ? v : 1
  } catch {
    return 1
  }
}

const BTN =
  "grid size-9 shrink-0 place-items-center rounded-md text-white/90 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-5"

// Video with Nimbus's own controls. Space or K plays, J/L skip 10 s, arrows
// skip 5 s once the player has focus, M mutes, F goes fullscreen.
export function VideoPlayer({
  src,
  title,
  onError,
  onUseFrame,
}: {
  src: string
  title: string
  onError: () => void
  // Shown to the file's editors: makes the current frame its thumbnail.
  onUseFrame?: (video: HTMLVideoElement) => Promise<void>
}) {
  const box = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const hideTimer = useRef(0)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [full, setFull] = useState(false)
  const [idle, setIdle] = useState(false)
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null)
  const [frame, setFrame] = useState<"saving" | "saved" | "failed" | null>(null)

  // Fit the video's own shape into the space the previewer gives it.
  useEffect(() => {
    const parent = box.current?.parentElement
    const v = video.current
    if (!parent || !v) return
    const fit = () => {
      if (!v.videoWidth) return
      const s = Math.min(
        parent.clientWidth / v.videoWidth,
        parent.clientHeight / v.videoHeight
      )
      setSize({ w: v.videoWidth * s, h: v.videoHeight * s })
    }
    const ro = new ResizeObserver(fit)
    ro.observe(parent)
    v.addEventListener("loadedmetadata", fit)
    return () => {
      ro.disconnect()
      v.removeEventListener("loadedmetadata", fit)
    }
  }, [])

  useEffect(() => {
    const v = video.current!
    v.volume = savedVolume()
    setVolume(v.volume)
    const onFull = () => setFull(document.fullscreenElement === box.current)
    document.addEventListener("fullscreenchange", onFull)
    return () => {
      document.removeEventListener("fullscreenchange", onFull)
      clearTimeout(hideTimer.current)
    }
  }, [])

  function wake() {
    setIdle(false)
    clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setIdle(true), HIDE_AFTER)
  }

  const v = () => video.current!
  const toggle = () =>
    v().paused
      ? v()
          .play()
          .catch(() => {})
      : v().pause()
  const skip = (s: number) => {
    v().currentTime = Math.min(Math.max(v().currentTime + s, 0), duration)
    wake()
  }
  const setVol = (n: number) => {
    v().volume = n
    v().muted = n === 0
    try {
      if (n > 0) localStorage.setItem(VOLUME_KEY, String(n))
    } catch {}
  }
  async function saveFrame() {
    setFrame("saving")
    try {
      await onUseFrame!(v())
      setFrame("saved")
    } catch {
      setFrame("failed")
    }
    setTimeout(() => setFrame(null), 2000)
  }

  const toggleFull = () =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : box.current!.requestFullscreen().catch(() => {})

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.target as HTMLElement).closest("[role=menu], input")) return
    const keys: Record<string, () => void> = {
      " ": toggle,
      k: toggle,
      j: () => skip(-10),
      l: () => skip(10),
      ArrowLeft: () => skip(-5),
      ArrowRight: () => skip(5),
      m: () => (v().muted = !v().muted),
      f: toggleFull,
    }
    const run = keys[e.key]
    if (!run || e.ctrlKey || e.metaKey || e.altKey) return
    e.preventDefault()
    e.stopPropagation()
    run()
  }

  const shown = !playing || !idle
  const VolumeIcon =
    muted || volume === 0
      ? SpeakerSlashIcon
      : volume < 0.5
        ? SpeakerLowIcon
        : SpeakerHighIcon
  const pct = (n: number) => `${duration ? (n / duration) * 100 : 0}%`

  return (
    <div
      ref={box}
      role="region"
      aria-label={`Video player: ${title}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerMove={wake}
      onPointerLeave={() => playing && setIdle(true)}
      style={size && !full ? { width: size.w, height: size.h } : undefined}
      className={cn(
        "group/player relative m-auto size-full overflow-hidden rounded-xl bg-black shadow-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&:fullscreen]:rounded-none",
        !shown && "cursor-none"
      )}
    >
      <video
        ref={video}
        src={src}
        // CORS mode, so a frame can be drawn to a canvas for the thumbnail.
        crossOrigin="anonymous"
        autoPlay
        playsInline
        onClick={toggle}
        onDoubleClick={toggleFull}
        onPlay={() => {
          setPlaying(true)
          wake()
        }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onPlaying={() => setWaiting(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered
          if (b.length) setBuffered(b.end(b.length - 1))
        }}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume)
          setMuted(e.currentTarget.muted)
        }}
        onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
        onError={onError}
        className="size-full object-contain"
      />

      {waiting && (
        <CircleNotchIcon className="pointer-events-none absolute inset-0 m-auto size-10 animate-spin text-white/80 motion-reduce:animate-none" />
      )}
      {!playing && !waiting && (
        <button
          type="button"
          aria-label="Play"
          onClick={toggle}
          className="absolute inset-0 m-auto grid size-16 place-items-center rounded-full bg-black/50 text-white ring-1 ring-white/15 backdrop-blur-md transition-transform outline-none hover:scale-105 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
        >
          <PlayIcon weight="fill" className="ml-1 size-7" />
        </button>
      )}

      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-linear-to-t from-black/85 via-black/45 to-transparent px-3 pt-12 pb-2 transition-opacity duration-200 group-focus-within/player:opacity-100 motion-reduce:transition-none",
          shown ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        {/* Seek bar: a native range for input and a11y over a drawn track. */}
        <div
          className="group/seek relative flex h-4 items-center"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const x = Math.min(Math.max(e.clientX - r.left, 0), r.width)
            setHover({ x, t: (x / r.width) * duration })
          }}
          onPointerLeave={() => setHover(null)}
        >
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] duration-100 group-hover/seek:h-1.5">
            <div
              className="absolute inset-y-0 left-0 bg-white/35"
              style={{ width: pct(buffered) }}
            />
            <div
              className="absolute inset-y-0 left-0 bg-brand"
              style={{ width: pct(time) }}
            />
          </div>
          <div
            className="pointer-events-none absolute size-3 -translate-x-1/2 scale-0 rounded-full bg-brand shadow-md transition-transform duration-100 group-hover/seek:scale-100 group-has-focus-visible/seek:scale-100"
            style={{ left: pct(time) }}
          />
          {hover && duration > 0 && (
            <span
              className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded-md bg-black/80 px-1.5 py-0.5 text-xs text-white tabular-nums"
              style={{ left: hover.x }}
            >
              {clock(hover.t)}
            </span>
          )}
          <input
            type="range"
            aria-label="Seek"
            aria-valuetext={`${clock(time)} of ${clock(duration)}`}
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            onChange={(e) => {
              v().currentTime = Number(e.target.value)
              setTime(v().currentTime)
            }}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </div>

        <div className="flex items-center gap-1 text-white">
          <button
            type="button"
            className={BTN}
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause (K)" : "Play (K)"}
            onClick={toggle}
          >
            {playing ? <PauseIcon weight="fill" /> : <PlayIcon weight="fill" />}
          </button>

          <div className="group/vol flex items-center">
            <button
              type="button"
              className={BTN}
              aria-label={muted ? "Unmute" : "Mute"}
              title={muted ? "Unmute (M)" : "Mute (M)"}
              onClick={() => (v().muted = !v().muted)}
            >
              <VolumeIcon weight="fill" />
            </button>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => setVol(Number(e.target.value))}
              style={
                {
                  "--v": `${(muted ? 0 : volume) * 100}%`,
                } as React.CSSProperties
              }
              className="h-1 w-0 cursor-pointer appearance-none rounded-full bg-[linear-gradient(to_right,white_var(--v),rgb(255_255_255/0.25)_var(--v))] opacity-0 transition-[width,opacity,margin] duration-150 outline-none group-hover/vol:mr-2 group-hover/vol:w-20 group-hover/vol:opacity-100 focus-visible:mr-2 focus-visible:w-20 focus-visible:opacity-100 max-sm:hidden [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            />
          </div>

          <span className="px-1 text-xs whitespace-nowrap text-white/90 tabular-nums sm:text-sm">
            {clock(time)}
            <span className="text-white/50"> / {clock(duration)}</span>
          </span>

          <span className="ml-auto" />

          <Menu.Root>
            <Menu.Trigger
              className={cn(
                BTN,
                "w-auto min-w-11 px-2 text-sm font-medium tabular-nums"
              )}
              aria-label={`Playback speed, ${speed}×`}
              title="Playback speed"
            >
              {speed}×
            </Menu.Trigger>
            <Menu.Portal container={box}>
              <Menu.Positioner side="top" align="end" sideOffset={8}>
                <Menu.Popup className={cn("w-36", MENU_POPUP)}>
                  <Menu.RadioGroup
                    value={speed}
                    onValueChange={(s: number) => (v().playbackRate = s)}
                  >
                    {SPEEDS.map((s) => (
                      <Menu.RadioItem
                        key={s}
                        value={s}
                        className={cn(MENU_ITEM, "tabular-nums")}
                      >
                        {s === 1 ? "Normal" : `${s}×`}
                        <Menu.RadioItemIndicator className="ml-auto">
                          <CheckIcon />
                        </Menu.RadioItemIndicator>
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>

          {onUseFrame && (
            <button
              type="button"
              className={cn(BTN, "max-sm:hidden")}
              aria-label="Use this frame as the thumbnail"
              title={
                frame === "saved"
                  ? "Thumbnail updated"
                  : frame === "failed"
                    ? "Couldn't save the thumbnail"
                    : "Use this frame as the thumbnail"
              }
              disabled={frame === "saving"}
              onClick={saveFrame}
            >
              {frame === "saving" ? (
                <CircleNotchIcon className="animate-spin motion-reduce:animate-none" />
              ) : frame === "saved" ? (
                <CheckIcon className="text-brand" />
              ) : frame === "failed" ? (
                <WarningCircleIcon className="text-destructive" />
              ) : (
                <ImageSquareIcon />
              )}
            </button>
          )}
          {typeof document !== "undefined" &&
            document.pictureInPictureEnabled && (
              <button
                type="button"
                className={cn(BTN, "max-sm:hidden")}
                aria-label="Picture in picture"
                title="Picture in picture"
                onClick={() =>
                  document.pictureInPictureElement
                    ? document.exitPictureInPicture()
                    : v()
                        .requestPictureInPicture()
                        .catch(() => {})
                }
              >
                <PictureInPictureIcon />
              </button>
            )}

          <button
            type="button"
            className={BTN}
            aria-label={full ? "Exit full screen" : "Full screen"}
            title={full ? "Exit full screen (F)" : "Full screen (F)"}
            onClick={toggleFull}
          >
            {full ? <CornersInIcon /> : <CornersOutIcon />}
          </button>
        </div>
      </div>
    </div>
  )
}
