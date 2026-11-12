"use client"

import "@fontsource/caveat/latin-400.css"
import "@fontsource/dancing-script/latin-400.css"
import "@fontsource/great-vibes/latin-400.css"

import { Dialog } from "@base-ui/react/dialog"
import { useEffect, useRef, useState } from "react"

import { DIALOG_BACKDROP, DIALOG_POPUP } from "@/components/overlay-styles"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Make a signature or initials three ways: draw, type, or upload a picture. The result is a transparent PNG cropped
// to the ink, at most MAX_W wide (the API takes 300 KB), and the person may keep it for next time.

const FONTS = ["Caveat", "Dancing Script", "Great Vibes"] as const
const INKS = [
  ["Black", "#111827"],
  ["Blue", "#1d4ed8"],
] as const
const PAD_W = 1120
const PAD_H = 400
const MAX_W = 640

type Tab = "draw" | "type" | "upload"

// The bounding box of non-transparent pixels, plus a margin; null when nothing is drawn.
function trimmed(c: HTMLCanvasElement) {
  const { width, height } = c
  const d = c.getContext("2d")!.getImageData(0, 0, width, height).data
  let [x1, y1, x2, y2] = [width, height, -1, -1]
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (d[(y * width + x) * 4 + 3] > 8) {
        x1 = Math.min(x1, x)
        x2 = Math.max(x2, x)
        y1 = Math.min(y1, y)
        y2 = Math.max(y2, y)
      }
  if (x2 < 0) return null
  const m = 6
  const w = x2 - x1 + 1 + 2 * m
  const h = y2 - y1 + 1 + 2 * m
  const k = Math.min(1, MAX_W / w)
  const out = document.createElement("canvas")
  out.width = Math.max(1, Math.round(w * k))
  out.height = Math.max(1, Math.round(h * k))
  const ctx = out.getContext("2d")!
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(c, x1 - m, y1 - m, w, h, 0, 0, out.width, out.height)
  return out
}

// A photographed signature on white paper: near-white pixels fade to transparent.
function withoutPaper(img: ImageBitmap) {
  const k = Math.min(1, 1200 / Math.max(img.width, img.height))
  const c = document.createElement("canvas")
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  const ctx = c.getContext("2d")!
  ctx.drawImage(img, 0, 0, c.width, c.height)
  const data = ctx.getImageData(0, 0, c.width, c.height)
  const d = data.data
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
    if (lum >= 240) d[i + 3] = 0
    else if (lum > 200) d[i + 3] = Math.round((d[i + 3] * (240 - lum)) / 40)
  }
  ctx.putImageData(data, 0, 0)
  return c
}

const blobOf = (c: HTMLCanvasElement) =>
  new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no()), "image/png"))

export function SignatureDialog({
  kind,
  onDone,
  onClose,
}: {
  kind: "signature" | "initials"
  // `keep`: save it to the account for next time.
  onDone: (png: Uint8Array, keep: boolean) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>("draw")
  const [ink, setInk] = useState<string>(INKS[0][1])
  const [text, setText] = useState("")
  const [font, setFont] = useState<string>(FONTS[0])
  const [keep, setKeep] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drawn, setDrawn] = useState(false)
  const [picked, setPicked] = useState<HTMLCanvasElement | null>(null)
  const [busy, setBusy] = useState(false)
  const pad = useRef<HTMLCanvasElement>(null)
  const pen = useRef<{ x: number; y: number } | null>(null)
  const word = kind === "signature" ? "signature" : "initials"

  const typed = () => {
    const c = document.createElement("canvas")
    c.width = PAD_W
    c.height = PAD_H
    const ctx = c.getContext("2d")!
    let size = 220
    ctx.font = `${size}px "${font}"`
    while (ctx.measureText(text).width > PAD_W - 40 && size > 40) ctx.font = `${(size -= 10)}px "${font}"`
    ctx.fillStyle = ink
    ctx.textBaseline = "alphabetic"
    ctx.fillText(text, 20, PAD_H * 0.65)
    return c
  }

  useEffect(() => {
    // The handwriting fonts load when first used; draw with them only once they're in.
    for (const f of FONTS) void document.fonts.load(`40px "${f}"`)
  }, [])

  const ready =
    tab === "draw" ? drawn : tab === "type" ? text.trim().length > 0 : Boolean(picked)

  function pos(e: React.PointerEvent) {
    const r = pad.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * PAD_W, y: ((e.clientY - r.top) / r.height) * PAD_H }
  }
  function stroke(from: { x: number; y: number }, to: { x: number; y: number }) {
    const ctx = pad.current!.getContext("2d")!
    ctx.strokeStyle = ink
    ctx.lineWidth = 7
    ctx.lineCap = ctx.lineJoin = "round"
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }
  function clear() {
    pad.current?.getContext("2d")?.clearRect(0, 0, PAD_W, PAD_H)
    setDrawn(false)
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      setPicked(withoutPaper(await createImageBitmap(file)))
    } catch {
      setError("Couldn't read that picture. Try a PNG or JPEG.")
    }
  }

  async function use() {
    setBusy(true)
    setError(null)
    try {
      await document.fonts.load(`40px "${font}"`)
      const src = tab === "draw" ? pad.current! : tab === "type" ? typed() : picked!
      const c = trimmed(src)
      if (!c) return setError(`Add your ${word} first.`)
      onDone(new Uint8Array(await (await blobOf(c)).arrayBuffer()), keep)
    } catch {
      setError(`Couldn't make the ${word}. Try again.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={cn(DIALOG_BACKDROP, "z-[70]")} />
        <Dialog.Popup className={cn(DIALOG_POPUP, "z-[70] max-w-xl")}>
          <div className="grid gap-1.5">
            <Dialog.Title className="text-base font-semibold">
              {kind === "signature" ? "Your signature" : "Your initials"}
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              Draw it, type it or upload a picture. You can move and resize it on the page.
            </Dialog.Description>
          </div>

          <div role="tablist" aria-label="How to make it" className="flex gap-1">
            {(["draw", "type", "upload"] as const).map((t) => (
              <Button
                key={t}
                role="tab"
                aria-selected={tab === t}
                variant={tab === t ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setTab(t)}
              >
                {t === "draw" ? "Draw" : t === "type" ? "Type" : "Upload"}
              </Button>
            ))}
            {tab !== "upload" && (
              <div role="radiogroup" aria-label="Ink" className="ml-auto flex items-center gap-1.5">
                {INKS.map(([label, hex]) => (
                  <button
                    key={hex}
                    type="button"
                    role="radio"
                    aria-checked={ink === hex}
                    aria-label={label}
                    title={label}
                    onClick={() => setInk(hex)}
                    className={cn(
                      "grid size-8 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60",
                      ink === hex && "bg-muted"
                    )}
                  >
                    <span className="size-5 rounded-full border border-white/30" style={{ background: hex }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            className="rounded-lg border bg-white text-neutral-900"
            style={{ backgroundImage: "linear-gradient(transparent calc(100% - 44px), #d4d4d4 calc(100% - 44px) calc(100% - 43px), transparent calc(100% - 43px))" }}
          >
            {tab === "draw" && (
              <div className="relative">
                <canvas
                  ref={pad}
                  width={PAD_W}
                  height={PAD_H}
                  role="img"
                  aria-label={`Draw your ${word} here`}
                  className="block aspect-[2.8/1] w-full touch-none cursor-crosshair"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    pen.current = pos(e)
                    stroke(pen.current, pen.current)
                    setDrawn(true)
                  }}
                  onPointerMove={(e) => {
                    if (!pen.current) return
                    const p = pos(e)
                    stroke(pen.current, p)
                    pen.current = p
                  }}
                  onPointerUp={() => (pen.current = null)}
                  onPointerCancel={() => (pen.current = null)}
                />
                {!drawn && (
                  <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-neutral-400">
                    Sign here with your finger, pen or mouse
                  </p>
                )}
              </div>
            )}
            {tab === "type" && (
              <div className="grid gap-3 p-4">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-label={kind === "signature" ? "Your name" : "Your initials"}
                  placeholder={kind === "signature" ? "Type your name" : "Type your initials"}
                  maxLength={40}
                  autoFocus
                  className="h-10 rounded-md border border-neutral-300 bg-white px-3 text-base text-neutral-900 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-400/50"
                />
                <div role="radiogroup" aria-label="Handwriting style" className="grid gap-2 sm:grid-cols-3">
                  {FONTS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="radio"
                      aria-checked={font === f}
                      onClick={() => setFont(f)}
                      className={cn(
                        "flex h-16 items-center justify-center overflow-hidden rounded-md border px-2 text-3xl outline-none focus-visible:ring-[3px] focus-visible:ring-blue-400/50",
                        font === f ? "border-blue-500 bg-blue-50" : "border-neutral-200 hover:bg-neutral-50"
                      )}
                      style={{ fontFamily: `"${f}"`, color: ink }}
                    >
                      {text.trim() || (kind === "signature" ? "Your name" : "AB")}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {tab === "upload" && (
              <div className="grid min-h-40 place-items-center gap-3 p-4 text-center">
                {picked ? (
                  <canvas
                    ref={(el) => {
                      if (el && picked) {
                        el.width = picked.width
                        el.height = picked.height
                        el.getContext("2d")!.drawImage(picked, 0, 0)
                      }
                    }}
                    role="img"
                    aria-label="Your picture with the background removed"
                    className="max-h-40 max-w-full object-contain"
                  />
                ) : (
                  <p className="text-sm text-neutral-500">
                    A photo of your {word} on white paper works best. The white is removed.
                  </p>
                )}
                <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-neutral-300 bg-white px-3.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50 has-focus-visible:ring-[3px] has-focus-visible:ring-blue-400/50">
                  {picked ? "Choose another picture" : "Choose a picture"}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      void chooseFile(e.target.files?.[0])
                      e.target.value = ""
                    }}
                  />
                </label>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={keep}
              onChange={(e) => setKeep(e.target.checked)}
              className="size-4 accent-brand"
            />
            Keep it for next time (on your account, for the web and the app)
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {tab === "draw" && drawn && (
              <Button variant="ghost" onClick={clear} className="sm:mr-auto">
                Clear
              </Button>
            )}
            <Dialog.Close render={<Button variant="outline" />}>Cancel</Dialog.Close>
            <Button disabled={!ready || busy} onClick={use}>
              {busy ? "Working…" : "Use it"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
