"use client"

import { Dialog } from "@base-ui/react/dialog"
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  ArrowUpRightIcon,
  CropIcon,
  FlipHorizontalIcon,
  HighlighterIcon,
  PencilSimpleLineIcon,
  TextTIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { readExif, withExif } from "@nimbus/shared/exif-write"
import {
  MAX_ANGLE,
  dragCrop,
  fitAspect,
  innerSize,
  type Handle,
  type Rect,
} from "@nimbus/shared/image-edit"
import { cn } from "@/lib/utils"

// Photo quick edits on a native <canvas>: crop, rotate, flip, straighten and markup. No colour adjustments.
// Reads the picture, draws it through the geometry, then the markup on top, and hands back a File of the same type.
// A JPEG keeps its EXIF date and GPS (shared/exif-write); the original stays as a version, the server's doing.

export const EDITABLE = /^image\/(jpeg|png|webp)$/
export const canEditImage = (mime: string | null) => EDITABLE.test(mime ?? "")

type Geo = {
  quarter: number
  flip: boolean
  angle: number
  crop: Rect
  aspect: number | null
}
type Pt = [number, number]
// Markup is stored 0..1 of the cropped picture, widths 0..1 of its shorter side.
type Op =
  | { kind: "pen" | "highlighter"; color: string; w: number; pts: Pt[] }
  | { kind: "arrow"; color: string; w: number; a: Pt; b: Pt }
  | { kind: "text"; color: string; size: number; at: Pt; text: string }
type Tool = Op["kind"]

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }
const START: Geo = {
  quarter: 0,
  flip: false,
  angle: 0,
  crop: FULL,
  aspect: null,
}
const COLORS = [
  ["Red", "#ef4444"],
  ["Yellow", "#facc15"],
  ["Green", "#22c55e"],
  ["Blue", "#3b82f6"],
  ["White", "#ffffff"],
  ["Black", "#000000"],
] as const
const WIDTH: Record<Tool, number> = {
  pen: 0.008,
  highlighter: 0.04,
  arrow: 0.009,
  text: 0.07,
}
const ASPECTS = [
  ["Free", null],
  ["1:1", 1],
  ["4:3", 4 / 3],
  ["16:9", 16 / 9],
] as const
// Keeps a 50-megapixel photo from needing a 200 MB canvas.
const MAX_PIXELS = 36e6

// The picture after rotate, flip and straighten, before the crop box: its size, and the biggest box left inside it.
function frame(bm: { width: number; height: number }, g: Geo) {
  const odd = g.quarter % 2 === 1
  const W = odd ? bm.height : bm.width
  const H = odd ? bm.width : bm.height
  return { W, H, inner: innerSize(W, H, g.angle) }
}

// The cropped result as a canvas `scale` times its natural size.
function draw(bm: ImageBitmap, g: Geo, crop: Rect, scale: number) {
  const { W, H, inner } = frame(bm, g)
  const ow = crop.w * inner.w
  const oh = crop.h * inner.h
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(ow * scale))
  c.height = Math.max(1, Math.round(oh * scale))
  const ctx = c.getContext("2d")!
  ctx.imageSmoothingQuality = "high"
  ctx.scale(c.width / ow, c.height / oh)
  ctx.translate(
    W / 2 - ((W - inner.w) / 2 + crop.x * inner.w),
    H / 2 - ((H - inner.h) / 2 + crop.y * inner.h)
  )
  ctx.rotate((g.angle * Math.PI) / 180)
  ctx.scale(g.flip ? -1 : 1, 1)
  ctx.rotate((g.quarter * Math.PI) / 2)
  ctx.drawImage(bm, -bm.width / 2, -bm.height / 2)
  return c
}

function paint(c: HTMLCanvasElement, ops: Op[]) {
  const ctx = c.getContext("2d")!
  ctx.clearRect(0, 0, c.width, c.height)
  const unit = Math.min(c.width, c.height)
  const px = ([x, y]: Pt): Pt => [x * c.width, y * c.height]
  ctx.lineCap = ctx.lineJoin = "round"
  for (const op of ops) {
    ctx.save()
    ctx.strokeStyle = ctx.fillStyle = op.color
    if (op.kind === "text") {
      ctx.font = `600 ${op.size * unit}px Geist, system-ui, sans-serif`
      ctx.textBaseline = "top"
      const [x, y] = px(op.at)
      ctx.fillText(op.text, x, y)
    } else if (op.kind === "arrow") {
      const [ax, ay] = px(op.a)
      const [bx, by] = px(op.b)
      const w = op.w * unit
      const turn = Math.atan2(by - ay, bx - ax)
      const head = Math.min(w * 5, Math.hypot(bx - ax, by - ay) / 2)
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(
        bx - Math.cos(turn) * head * 0.6,
        by - Math.sin(turn) * head * 0.6
      )
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(bx, by)
      for (const s of [-1, 1])
        ctx.lineTo(
          bx - head * Math.cos(turn - s * 0.45),
          by - head * Math.sin(turn - s * 0.45)
        )
      ctx.closePath()
      ctx.fill()
    } else {
      // One path, so a highlighter's overlaps don't darken.
      ctx.lineWidth = op.w * unit
      if (op.kind === "highlighter") ctx.globalAlpha = 0.35
      ctx.beginPath()
      op.pts.forEach((p, i) => {
        const [x, y] = px(p)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      if (op.pts.length === 1)
        ctx.lineTo(px(op.pts[0])[0] + 0.01, px(op.pts[0])[1])
      ctx.stroke()
    }
    ctx.restore()
  }
}

const toBlob = (c: HTMLCanvasElement, type: string) =>
  new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), type, 0.92)
  )

const HANDLES: [Handle, string, string][] = [
  [
    "nw",
    "top left",
    "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  ],
  [
    "n",
    "top",
    "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
  ],
  [
    "ne",
    "top right",
    "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  ],
  [
    "e",
    "right",
    "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  ],
  [
    "se",
    "bottom right",
    "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
  ],
  [
    "s",
    "bottom",
    "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  ],
  [
    "sw",
    "bottom left",
    "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  ],
  [
    "w",
    "left",
    "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  ],
]

export function ImageEditor({
  name,
  mime,
  src,
  takenAt,
  copy = false,
  saveLabel = "Save",
  onSave,
  onClose,
}: {
  name: string
  mime: string
  // The picture: a URL to fetch, or the bytes.
  src: string | Blob
  // Used when the file carries no date of its own.
  takenAt?: Date
  // Offer "Save as copy" next to Save.
  copy?: boolean
  saveLabel?: string
  // Resolves to an error message, or null when it went through (the editor then closes).
  onSave: (file: File, as: "version" | "copy") => Promise<string | null>
  onClose: () => void
}) {
  const type = EDITABLE.test(mime) ? mime : "image/jpeg"
  const [bm, setBm] = useState<ImageBitmap | null>(null)
  const [meta, setMeta] = useState<ReturnType<typeof readExif>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<"version" | "copy" | null>(null)
  const [geo, setGeo] = useState<Geo>(START)
  const [mode, setMode] = useState<"crop" | "markup">("crop")
  const [tool, setTool] = useState<Tool>("pen")
  const [color, setColor] = useState<string>(COLORS[0][1])
  const [ops, setOps] = useState<Op[]>([])
  const [undone, setUndone] = useState<Op[]>([])
  const [draft, setDraft] = useState<Op | null>(null)
  const [typing, setTyping] = useState<Pt | null>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  // State, not a ref: the dialog's portal attaches the stage after the first render, so a mount-only effect
  // would miss it (only Strict Mode's second run in dev would see it).
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null)
  const base = useRef<HTMLCanvasElement>(null)
  const marks = useRef<HTMLCanvasElement>(null)

  // Load the picture; a JPEG's EXIF is read from the same bytes.
  useEffect(() => {
    let live = true
    ;(async () => {
      const blob =
        typeof src === "string" ? await (await fetch(src)).blob() : src
      const [img, bytes] = await Promise.all([
        createImageBitmap(blob),
        mime === "image/jpeg"
          ? blob.arrayBuffer().then((b) => readExif(new Uint8Array(b)))
          : {},
      ])
      if (!live) return img.close()
      setBm(img)
      setMeta(bytes)
    })().catch(() => live && setError("Couldn't open this photo for editing."))
    return () => {
      live = false
    }
  }, [src, mime])
  useEffect(() => () => bm?.close(), [bm])

  useEffect(() => {
    const el = stageEl
    if (!el) return
    const ro = new ResizeObserver(() =>
      setStage({ w: el.clientWidth, h: el.clientHeight })
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [stageEl])

  const dirty = ops.length > 0 || JSON.stringify(geo) !== JSON.stringify(START)
  const { inner } = bm ? frame(bm, geo) : { inner: { w: 1, h: 1 } }
  const ratio = inner.w / inner.h
  // What the stage shows: the whole straightened picture to crop, or the crop to mark up.
  const view = mode === "crop" ? FULL : geo.crop
  const vw = view.w * inner.w
  const vh = view.h * inner.h
  const pad = 24
  const fit = Math.min((stage.w - pad) / vw, (stage.h - pad) / vh)
  const shown =
    fit > 0 && bm ? { w: Math.floor(vw * fit), h: Math.floor(vh * fit) } : null
  const [vx, vy, vww, vhh] = [view.x, view.y, view.w, view.h]

  useEffect(() => {
    if (!bm || !shown || !base.current) return
    const dpr = window.devicePixelRatio || 1
    const c = draw(bm, geo, { x: vx, y: vy, w: vww, h: vhh }, fit * dpr)
    const t = base.current
    t.width = c.width
    t.height = c.height
    t.getContext("2d")!.drawImage(c, 0, 0)
    if (marks.current) {
      marks.current.width = c.width
      marks.current.height = c.height
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shown is derived from fit and the picture
  }, [
    bm,
    geo.quarter,
    geo.flip,
    geo.angle,
    vx,
    vy,
    vww,
    vhh,
    shown?.w,
    shown?.h,
  ])

  useEffect(() => {
    if (marks.current && mode === "markup")
      paint(marks.current, draft ? [...ops, draft] : ops)
  }, [ops, draft, mode, shown?.w, shown?.h, bm, geo.crop])

  // Geometry changes redraw the picture, so the crop box and the markup start over.
  function change(next: Partial<Geo>) {
    setGeo((g) => {
      const n = { ...g, ...next }
      if (!("crop" in next) && bm) {
        const r = frame(bm, n).inner
        n.crop = n.aspect ? fitAspect(n.aspect, r.w / r.h) : FULL
      }
      return n
    })
    if (!("crop" in next) || ops.length) {
      setOps([])
      setUndone([])
    }
  }
  const pickAspect = (a: number | null) => {
    // Tapping the chosen shape again turns it sideways.
    const next = a !== null && a !== 1 && geo.aspect === a ? 1 / a : a
    change({ aspect: next, crop: next ? fitAspect(next, ratio) : geo.crop })
  }

  // ---- Crop box ----
  const drag = useRef<{ h: Handle; x: number; y: number; r: Rect } | null>(null)
  const down = (h: Handle, e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { h, x: e.clientX, y: e.clientY, r: geo.crop }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !shown) return
    change({
      crop: dragCrop(
        d.r,
        d.h,
        (e.clientX - d.x) / shown.w,
        (e.clientY - d.y) / shown.h,
        ratio,
        geo.aspect
      ),
    })
  }
  const nudge = (h: Handle) => (e: React.KeyboardEvent) => {
    const k = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[e.key]
    if (!k) return
    e.preventDefault()
    e.stopPropagation()
    change({
      crop: dragCrop(geo.crop, h, k[0] * 0.01, k[1] * 0.01, ratio, geo.aspect),
    })
  }

  // ---- Markup ----
  const at = (e: React.PointerEvent): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ]
  }
  const commit = (op: Op) => {
    setOps((o) => [...o, op])
    setUndone([])
  }
  const markDown = (e: React.PointerEvent) => {
    if (tool === "text") {
      if (typing) return
      return setTyping(at(e))
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = at(e)
    setDraft(
      tool === "arrow"
        ? { kind: "arrow", color, w: WIDTH.arrow, a: p, b: p }
        : { kind: tool, color, w: WIDTH[tool], pts: [p] }
    )
  }
  const markMove = (e: React.PointerEvent) => {
    if (!draft) return
    const p = at(e)
    setDraft(
      draft.kind === "arrow"
        ? { ...draft, b: p }
        : draft.kind === "text"
          ? draft
          : { ...draft, pts: [...draft.pts, p] }
    )
  }
  const markUp = () => {
    if (!draft) return
    const tiny =
      draft.kind === "arrow" &&
      Math.hypot(
        (draft.b[0] - draft.a[0]) * inner.w,
        (draft.b[1] - draft.a[1]) * inner.h
      ) < 8
    if (!tiny) commit(draft)
    setDraft(null)
  }
  const undo = () => {
    const last = ops[ops.length - 1]
    if (!last) return
    setOps(ops.slice(0, -1))
    setUndone([last, ...undone])
  }
  const redo = () => {
    if (!undone.length) return
    setOps([...ops, undone[0]])
    setUndone(undone.slice(1))
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || mode !== "markup") return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault()
      return e.shiftKey ? redo() : undo()
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") redo()
  }

  // ---- Saving ----
  async function save(as: "version" | "copy") {
    if (!bm || saving) return
    setSaving(as)
    setError(null)
    try {
      const { inner } = frame(bm, geo)
      const natural = geo.crop.w * inner.w * geo.crop.h * inner.h
      const out = draw(
        bm,
        geo,
        geo.crop,
        Math.min(1, Math.sqrt(MAX_PIXELS / natural))
      )
      if (ops.length) {
        const layer = document.createElement("canvas")
        layer.width = out.width
        layer.height = out.height
        paint(layer, ops)
        out.getContext("2d")!.drawImage(layer, 0, 0)
      }
      let bytes: Uint8Array = new Uint8Array(
        await (await toBlob(out, type)).arrayBuffer()
      )
      const date = meta.takenAt ?? takenAt ?? null
      if (type === "image/jpeg")
        bytes = withExif(bytes, { takenAt: date, gps: meta.gps })
      const file = new File([bytes as BlobPart], name, {
        type,
        lastModified: date?.getTime() ?? Date.now(),
      })
      const failed = await onSave(file, as)
      if (failed) setError(failed)
    } catch {
      setError("Couldn't save the edited photo. Try again.")
    }
    setSaving(null)
  }

  function close() {
    if (dirty && !window.confirm("Discard your edits?")) return
    onClose()
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[60] bg-black" />
        <Dialog.Popup
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-[60] flex flex-col bg-background outline-none"
        >
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close editor"
              onClick={close}
            >
              <XIcon className="size-5" />
            </Button>
            <Dialog.Title className="min-w-0 truncate text-sm font-medium">
              Edit {name}
            </Dialog.Title>
            <div className="ml-auto flex items-center gap-1.5">
              {mode === "markup" && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Undo"
                    title="Undo"
                    disabled={!ops.length}
                    onClick={undo}
                  >
                    <ArrowUUpLeftIcon className="size-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Redo"
                    title="Redo"
                    disabled={!undone.length}
                    onClick={redo}
                  >
                    <ArrowUUpRightIcon className="size-5" />
                  </Button>
                </>
              )}
              {copy && (
                <Button
                  variant="outline"
                  disabled={!bm || !!saving}
                  onClick={() => save("copy")}
                >
                  {saving === "copy" ? "Saving…" : "Save as copy"}
                </Button>
              )}
              <Button
                disabled={!bm || !!saving}
                onClick={() => save("version")}
              >
                {saving === "version" ? "Saving…" : saveLabel}
              </Button>
            </div>
          </header>

          <div
            ref={setStageEl}
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/40"
          >
            {!bm && !error && (
              <p className="text-sm text-muted-foreground">Opening…</p>
            )}
            {shown && (
              <div
                className="relative select-none"
                style={{ width: shown.w, height: shown.h }}
              >
                <canvas
                  ref={base}
                  aria-label="Photo being edited"
                  role="img"
                  className="size-full"
                />
                <canvas
                  ref={marks}
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute inset-0 size-full",
                    mode === "crop" && "hidden"
                  )}
                />
                {mode === "markup" && (
                  <div
                    onPointerDown={markDown}
                    onPointerMove={markMove}
                    onPointerUp={markUp}
                    onPointerCancel={() => setDraft(null)}
                    className={cn(
                      "absolute inset-0 touch-none",
                      tool === "text" ? "cursor-text" : "cursor-crosshair"
                    )}
                    aria-label={`Draw with ${tool}`}
                  >
                    {typing && (
                      <TextBox
                        at={typing}
                        color={color}
                        px={WIDTH.text * Math.min(shown.w, shown.h)}
                        onDone={(text) => {
                          if (text.trim())
                            commit({
                              kind: "text",
                              color,
                              size: WIDTH.text,
                              at: typing,
                              text,
                            })
                          setTyping(null)
                        }}
                      />
                    )}
                  </div>
                )}
                {mode === "crop" && (
                  <div
                    role="group"
                    aria-label="Crop area"
                    tabIndex={0}
                    onPointerDown={(e) => down("move", e)}
                    onPointerMove={move}
                    onPointerUp={() => (drag.current = null)}
                    onKeyDown={nudge("move")}
                    className="absolute cursor-move touch-none border border-white/90 shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
                    style={{
                      left: `${geo.crop.x * 100}%`,
                      top: `${geo.crop.y * 100}%`,
                      width: `${geo.crop.w * 100}%`,
                      height: `${geo.crop.h * 100}%`,
                      backgroundImage:
                        "linear-gradient(to right,transparent calc(33.33% - .5px),rgb(255 255 255/.35) calc(33.33% - .5px) calc(33.33% + .5px),transparent calc(33.33% + .5px) calc(66.66% - .5px),rgb(255 255 255/.35) calc(66.66% - .5px) calc(66.66% + .5px),transparent calc(66.66% + .5px)),linear-gradient(to bottom,transparent calc(33.33% - .5px),rgb(255 255 255/.35) calc(33.33% - .5px) calc(33.33% + .5px),transparent calc(33.33% + .5px) calc(66.66% - .5px),rgb(255 255 255/.35) calc(66.66% - .5px) calc(66.66% + .5px),transparent calc(66.66% + .5px))",
                    }}
                  >
                    {HANDLES.filter(([h]) => !geo.aspect || h.length === 2).map(
                      ([h, label, pos]) => (
                        <button
                          key={h}
                          type="button"
                          aria-label={`Resize crop, ${label}`}
                          onPointerDown={(e) => down(h, e)}
                          onPointerMove={move}
                          onPointerUp={() => (drag.current = null)}
                          onKeyDown={nudge(h)}
                          className={cn(
                            "absolute grid size-8 touch-none place-items-center outline-none focus-visible:*:ring-[3px] focus-visible:*:ring-ring/60",
                            pos
                          )}
                        >
                          <span
                            className={cn(
                              "block bg-white shadow",
                              h.length === 2
                                ? "size-3 rounded-full"
                                : h === "n" || h === "s"
                                  ? "h-1.5 w-6 rounded-full"
                                  : "h-6 w-1.5 rounded-full"
                            )}
                          />
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="border-t bg-destructive/10 px-4 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <div className="shrink-0 border-t">
            <div
              role="tablist"
              aria-label="Editor tools"
              className="flex gap-1 px-2 pt-2 sm:px-3"
            >
              {(
                [
                  ["crop", "Crop", CropIcon],
                  ["markup", "Markup", PencilSimpleLineIcon],
                ] as const
              ).map(([m, label, Icon]) => (
                <Button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  variant={mode === m ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setMode(m)
                    setTyping(null)
                  }}
                >
                  <Icon className="size-4" />
                  {label}
                </Button>
              ))}
            </div>
            <div className="flex min-h-16 items-center gap-x-5 gap-y-2 overflow-x-auto px-2 py-2 sm:px-3">
              {mode === "crop" ? (
                <>
                  <div
                    className="flex shrink-0 items-center gap-1"
                    role="group"
                    aria-label="Crop shape"
                  >
                    {ASPECTS.map(([label, a]) => {
                      const on =
                        geo.aspect !== null && a !== null
                          ? geo.aspect === a || geo.aspect === 1 / a
                          : geo.aspect === a
                      const sideways =
                        on && a !== null && a !== 1 && geo.aspect !== a
                      return (
                        <Button
                          key={label}
                          variant={on ? "secondary" : "ghost"}
                          size="sm"
                          aria-pressed={on}
                          onClick={() => pickAspect(a)}
                        >
                          {sideways
                            ? label.split(":").reverse().join(":")
                            : label}
                        </Button>
                      )
                    })}
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-1"
                    role="group"
                    aria-label="Rotate and flip"
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Rotate left"
                      title="Rotate left"
                      onClick={() => change({ quarter: (geo.quarter + 3) % 4 })}
                    >
                      <ArrowCounterClockwiseIcon className="size-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Rotate right"
                      title="Rotate right"
                      onClick={() => change({ quarter: (geo.quarter + 1) % 4 })}
                    >
                      <ArrowClockwiseIcon className="size-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Flip horizontally"
                      title="Flip horizontally"
                      aria-pressed={geo.flip}
                      onClick={() => change({ flip: !geo.flip })}
                    >
                      <FlipHorizontalIcon className="size-5" />
                    </Button>
                  </div>
                  <label className="flex min-w-56 shrink-0 items-center gap-3 text-sm">
                    <span className="text-muted-foreground">Straighten</span>
                    <input
                      type="range"
                      min={-MAX_ANGLE}
                      max={MAX_ANGLE}
                      step={0.5}
                      value={geo.angle}
                      aria-label="Straighten"
                      onChange={(e) =>
                        change({ angle: Number(e.target.value) })
                      }
                      onDoubleClick={() => change({ angle: 0 })}
                      className="h-1.5 w-40 accent-[var(--brand)]"
                    />
                    <span className="w-10 text-right font-mono text-xs tabular-nums">
                      {geo.angle}°
                    </span>
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!dirty}
                    onClick={() => change({ ...START })}
                  >
                    Reset
                  </Button>
                  {ops.length > 0 && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Changing the crop clears your markup.
                    </span>
                  )}
                </>
              ) : (
                <>
                  <div
                    className="flex shrink-0 items-center gap-1"
                    role="group"
                    aria-label="Markup tool"
                  >
                    {(
                      [
                        ["pen", "Pen", PencilSimpleLineIcon],
                        ["highlighter", "Highlighter", HighlighterIcon],
                        ["text", "Text", TextTIcon],
                        ["arrow", "Arrow", ArrowUpRightIcon],
                      ] as const
                    ).map(([t, label, Icon]) => (
                      <Button
                        key={t}
                        variant={tool === t ? "secondary" : "ghost"}
                        size="icon"
                        aria-label={label}
                        title={label}
                        aria-pressed={tool === t}
                        onClick={() => setTool(t)}
                      >
                        <Icon className="size-5" />
                      </Button>
                    ))}
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-1.5"
                    role="radiogroup"
                    aria-label="Colour"
                  >
                    {COLORS.map(([label, hex]) => (
                      <button
                        key={hex}
                        type="button"
                        role="radio"
                        aria-checked={color === hex}
                        aria-label={label}
                        title={label}
                        onClick={() => setColor(hex)}
                        className={cn(
                          "grid size-8 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60",
                          color === hex && "bg-muted"
                        )}
                      >
                        <span
                          className="size-5 rounded-full border border-white/30"
                          style={{ background: hex }}
                        />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// A text note being typed straight onto the photo; Enter or leaving the box places it.
function TextBox({
  at,
  color,
  px,
  onDone,
}: {
  at: Pt
  color: string
  px: number
  onDone: (text: string) => void
}) {
  const [text, setText] = useState("")
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <input
      ref={ref}
      value={text}
      aria-label="Text to add"
      onChange={(e) => setText(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter") onDone(text)
        else if (e.key === "Escape") onDone("")
      }}
      className="absolute min-w-24 border border-dashed border-white/60 bg-transparent p-0 leading-none font-semibold outline-none"
      style={{
        left: `${at[0] * 100}%`,
        top: `${at[1] * 100}%`,
        color,
        fontSize: px,
        fontFamily: "Geist, system-ui, sans-serif",
      }}
    />
  )
}
