"use client"

import { Menu } from "@base-ui/react/menu"
import { CheckIcon, MoonIcon, ScreencastIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import { useStore, type Resume, type SleepTimer } from "@/lib/media-extras"
import {
  SLEEP_PRESETS,
  SPEEDS,
  clock,
  sleepMinutes,
  sleepText,
} from "@/lib/player-rules"
import { cn } from "@/lib/utils"

// Controls the video player and the audio player share. `className` is the trigger's
// look, since one sits on a dark video and the other on the page.
type Look = { className: string; container?: React.RefObject<HTMLElement | null> }

export function SpeedMenu({
  speed,
  onChange,
  className,
  container,
}: Look & { speed: number; onChange: (s: number) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className={className}
        aria-label={`Playback speed, ${speed}×`}
        title="Playback speed"
      >
        {speed}×
      </Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Positioner side="top" align="end" sideOffset={8} className="z-[80]">
          <Menu.Popup className={cn("w-36", MENU_POPUP)}>
            <Menu.RadioGroup value={speed} onValueChange={onChange}>
              {SPEEDS.map((s) => (
                <Menu.RadioItem key={s} value={s} closeOnClick className={cn(MENU_ITEM, "tabular-nums")}>
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
  )
}

export function SleepMenu({
  timer,
  endLabel,
  className,
  container,
}: Look & { timer: SleepTimer; endLabel: string }) {
  const { sleep, left } = useStore(timer.store)
  const [custom, setCustom] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const minutes = custom === null ? null : sleepMinutes(custom)
  const start = (min: number) => timer.in(min)
  return (
    <Menu.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setCustom(null)
      }}
    >
      <Menu.Trigger
        className={cn(className, "inline-flex items-center gap-1.5", sleep && "text-brand")}
        aria-label={
          sleep
            ? sleep.kind === "end"
              ? `Sleep timer, stops at the end`
              : `Sleep timer, ${sleepText(left)} left`
            : "Sleep timer"
        }
        title="Sleep timer"
      >
        <MoonIcon weight={sleep ? "fill" : "regular"} />
        {sleep?.kind === "at" && left > 0 && (
          <span className="text-xs tabular-nums">{sleepText(left)}</span>
        )}
      </Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Positioner side="top" align="end" sideOffset={8} className="z-[80]">
          <Menu.Popup className={cn("w-48", MENU_POPUP)}>
            {custom === null ? (
              <>
                {SLEEP_PRESETS.map((m) => (
                  <Menu.Item key={m} className={MENU_ITEM} onClick={() => start(m)}>
                    {m} minutes
                  </Menu.Item>
                ))}
                <Menu.Item className={MENU_ITEM} onClick={() => timer.start({ kind: "end" })}>
                  {endLabel}
                  {sleep?.kind === "end" && <CheckIcon className="ml-auto" />}
                </Menu.Item>
                <Menu.Item
                  className={MENU_ITEM}
                  closeOnClick={false}
                  onClick={() => setCustom("")}
                >
                  Custom…
                </Menu.Item>
                {sleep && (
                  <Menu.Item className={cn(MENU_ITEM, "mt-1 border-t pt-1")} onClick={timer.cancel}>
                    Turn off
                  </Menu.Item>
                )}
              </>
            ) : (
              <form
                className="flex items-center gap-2 p-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!minutes) return
                  start(minutes)
                  setOpen(false)
                }}
              >
                <input
                  autoFocus
                  inputMode="numeric"
                  aria-label="Minutes"
                  placeholder="Minutes"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  // The menu would take these keys for its own.
                  onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}
                  className="h-8 w-full min-w-0 rounded-md border bg-background px-2 text-sm tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <button
                  type="submit"
                  disabled={!minutes}
                  className="h-8 shrink-0 rounded-md bg-primary px-2.5 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  Set
                </button>
              </form>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

// "Resume from 42:10 / Start over", shown over the player while the position is offered.
export function ResumePrompt({ resume, className }: { resume: Resume; className?: string }) {
  const { offer } = useStore(resume.store)
  if (offer === null) return null
  const btn =
    "h-8 rounded-full px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50"
  return (
    <div
      role="group"
      aria-label="Resume playback"
      className={cn(
        "flex items-center gap-1 rounded-full border bg-popover p-1 pl-4 text-sm text-popover-foreground shadow-lg",
        className
      )}
    >
      <span className="tabular-nums">Resume from {clock(offer)}?</span>
      <button type="button" onClick={resume.resume} className={cn(btn, "ml-1 bg-primary text-primary-foreground hover:bg-primary/90")}>
        Resume
      </button>
      <button type="button" onClick={resume.startOver} className={cn(btn, "hover:bg-accent")}>
        Start over
      </button>
    </div>
  )
}

export function CastButton({
  onClick,
  active,
  className,
}: {
  onClick: () => void
  active?: boolean
  className: string
}) {
  return (
    <button
      type="button"
      className={cn(className, active && "text-brand")}
      aria-label={active ? "Casting" : "Cast to a TV"}
      title="Cast to a TV"
      onClick={onClick}
    >
      <ScreencastIcon weight={active ? "fill" : "regular"} />
    </button>
  )
}
