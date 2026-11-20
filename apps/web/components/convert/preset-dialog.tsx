"use client"

import { Dialog } from "@base-ui/react/dialog"
import { useEffect, useId, useState, useTransition } from "react"

import { savePreset } from "@/app/(app)/more/convert/actions"
import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { SELECT, TOUCH } from "@/components/registry-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PresetView } from "@/lib/convert/jobs"
import { AUDIO_KBPS, HEIGHTS, parseTime, QUALITY, type Preset } from "@/lib/convert/rules"
import { cn } from "@/lib/utils"
import { clock } from "./format"

type Kind = Preset["kind"]
type Form = { name: string; kind: Kind; codec: string; container: string; height: string; crf: string; targetMb: string; start: string; end: string; width: string; fps: string; format: string; kbps: string; maxSide: string; quality: string }

const BLANK: Form = { name: "", kind: "video", codec: "h264", container: "mp4", height: "", crf: "23", targetMb: "", start: "", end: "", width: "480", fps: "12", format: "mp3", kbps: "192", maxSide: "", quality: "85" }
const FORMATS: Record<"audio" | "image", string[]> = { audio: ["mp3", "m4a", "opus", "flac", "wav"], image: ["jpg", "png", "webp", "avif"] }

function toForm(v: PresetView | null): Form {
  if (!v) return BLANK
  const p = v.preset
  const t = (n: number | undefined) => (n === undefined ? "" : clock(n))
  const f = { ...BLANK, name: v.name, kind: p.kind }
  if (p.kind === "video") return { ...f, codec: p.codec, container: p.container, height: String(p.height ?? ""), crf: String(p.crf ?? 23), targetMb: String(p.targetMb ?? ""), start: t(p.start), end: t(p.end) }
  if (p.kind === "gif") return { ...f, width: String(p.width), fps: String(p.fps), start: t(p.start), end: t(p.end) }
  if (p.kind === "audio") return { ...f, format: p.format, kbps: String(p.kbps) }
  return { ...f, format: p.format, maxSide: String(p.maxSide ?? ""), quality: String(p.quality) }
}

// Make or edit one of your own presets. `edit` null = a new one; the dialog is closed when `open` is false.
export function PresetDialog({ open, edit, onClose }: { open: boolean; edit: PresetView | null; onClose: () => void }) {
  const id = useId()
  const [f, setF] = useState<Form>(BLANK)
  const [error, setError] = useState<string>()
  const [pending, run] = useTransition()
  useEffect(() => {
    if (!open) return
    setF(toForm(edit))
    setError(undefined)
  }, [open, edit])
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }))
  const kindFormats = f.kind === "audio" || f.kind === "image" ? FORMATS[f.kind] : []

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const start = parseTime(f.start)
    const end = parseTime(f.end)
    if ((f.start && start === null) || (f.end && end === null)) return setError("Write trim times like 1:30 or 90.")
    const num = (s: string) => (s.trim() ? Number(s) : undefined)
    const preset =
      f.kind === "video"
        ? { kind: "video", codec: f.codec, container: f.container, height: num(f.height), crf: num(f.crf), targetMb: num(f.targetMb), start: start ?? undefined, end: end ?? undefined }
        : f.kind === "gif"
          ? { kind: "gif", width: num(f.width), fps: num(f.fps), start: start ?? undefined, end: end ?? undefined }
          : f.kind === "audio"
            ? { kind: "audio", format: f.format, kbps: num(f.kbps) }
            : { kind: "image", format: f.format, maxSide: num(f.maxSide), quality: num(f.quality) }
    run(async () => {
      const r = await savePreset({ id: edit?.id, name: f.name, preset }).catch(() => ({ error: "Couldn't save. Check your connection and try again." }))
      if (r.error) setError(r.error)
      else onClose()
    })
  }

  const field = (k: keyof Form, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`${id}-${k}`}>{label}</Label>
      <Input id={`${id}-${k}`} value={f[k]} onChange={set(k)} autoComplete="off" {...props} />
    </div>
  )
  const select = (k: keyof Form, label: string, options: [string, string][], disabled = false) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`${id}-${k}`}>{label}</Label>
      <select id={`${id}-${k}`} value={f[k]} onChange={set(k)} disabled={disabled} className={cn(SELECT, "pointer-coarse:h-11")}>
        {options.map(([v, t]) => (
          <option key={v} value={v}>{t}</option>
        ))}
      </select>
    </div>
  )

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={DIALOG_BACKDROP} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "max-h-[calc(100dvh-2rem)] overflow-y-auto")}>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Dialog.Title className="text-base font-semibold">{edit ? "Edit preset" : "New preset"}</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">Your own settings, saved to reuse. Converted files are named after the preset.</Dialog.Description>
            </div>
            {field("name", "Name", { maxLength: 40, required: true, placeholder: "Phone video" })}
            {select("kind", "Makes a", [["video", "Video"], ["gif", "GIF"], ["audio", "Audio file"], ["image", "Image"]], Boolean(edit))}
            {f.kind === "video" && (
              <div className="grid grid-cols-2 gap-3">
                {select("codec", "Codec", [["h264", "H.264 (works everywhere)"], ["h265", "H.265 (smaller)"], ["av1", "AV1 (smallest, slow)"]])}
                {select("container", "Container", [["mp4", "MP4"], ["mkv", "MKV"]])}
                {select("height", "Height", [["", "Keep as is"], ...HEIGHTS.map((h): [string, string] => [String(h), `${h}p`])])}
                {select("crf", "Quality", QUALITY.map(([t, v]): [string, string] => [String(v), t]))}
                {field("targetMb", "Target size (MB)", { type: "number", min: 1, placeholder: "optional" })}
              </div>
            )}
            {f.kind === "gif" && (
              <div className="grid grid-cols-2 gap-3">
                {field("width", "Width (px)", { type: "number", min: 64, max: 1280 })}
                {field("fps", "Frames per second", { type: "number", min: 1, max: 30 })}
              </div>
            )}
            {(f.kind === "video" || f.kind === "gif") && (
              <div className="grid grid-cols-2 gap-3">
                {field("start", "Trim start", { placeholder: "0:00", inputMode: "numeric" })}
                {field("end", "Trim end", { placeholder: "end", inputMode: "numeric" })}
              </div>
            )}
            {f.kind === "audio" && (
              <div className="grid grid-cols-2 gap-3">
                {select("format", "Format", kindFormats.map((x): [string, string] => [x, x.toUpperCase()]))}
                {select("kbps", "Bitrate", AUDIO_KBPS.map((k): [string, string] => [String(k), `${k} kbps`]), f.format === "flac" || f.format === "wav")}
              </div>
            )}
            {f.kind === "image" && (
              <div className="grid grid-cols-2 gap-3">
                {select("format", "Format", kindFormats.map((x): [string, string] => [x, x.toUpperCase()]))}
                {field("quality", "Quality (1 to 100)", { type: "number", min: 1, max: 100, disabled: f.format === "png" })}
                {field("maxSide", "Longest side (px)", { type: "number", min: 16, placeholder: "keep size" })}
              </div>
            )}
            {error && <p role="alert" className="text-sm text-pretty text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className={TOUCH} onClick={onClose}>Cancel</Button>
              <Button type="submit" className={TOUCH} disabled={pending}>{pending ? "Saving…" : "Save preset"}</Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
