"use client"

import "pdfjs-dist/web/pdf_viewer.css"

import { Dialog } from "@base-ui/react/dialog"
import { Menu } from "@base-ui/react/menu"
import {
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  ArrowUpRightIcon,
  CircleIcon,
  CursorIcon,
  EraserIcon,
  HighlighterIcon,
  LineSegmentIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  NoteIcon,
  PencilSimpleLineIcon,
  RectangleIcon,
  SignatureIcon,
  TextStrikethroughIcon,
  TextTIcon,
  TextUnderlineIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import { DIALOG_BACKDROP, DIALOG_POPUP, MENU_ITEM, MENU_POPUP } from "@/components/overlay-styles"
import { PDF_CHANGED } from "@/components/pdf-editor-types"
import { SignatureDialog } from "@/components/pdf-signature"
import { Button } from "@/components/ui/button"
import type { SignatureKind, SignaturesResponse } from "@nimbus/shared/api"
import { PdfEditor as Editor, type EditorState, type Tool } from "@nimbus/shared/pdf-editor"
import { cn } from "@/lib/utils"

// Editing a PDF in the browser: the shared editor (marks as real annotations, fields filled in) plus a toolbar,
// a saved signature, and Save / Save as copy. The host decides where the bytes go and says if the file moved on.

const TOOLS: [Tool, string, typeof CursorIcon][] = [
  ["select", "Select and fill in", CursorIcon],
  ["highlight", "Highlight", HighlighterIcon],
  ["underline", "Underline", TextUnderlineIcon],
  ["strike", "Strike out", TextStrikethroughIcon],
  ["note", "Sticky note", NoteIcon],
  ["text", "Text", TextTIcon],
  ["pen", "Pen", PencilSimpleLineIcon],
  ["rect", "Rectangle", RectangleIcon],
  ["ellipse", "Ellipse", CircleIcon],
  ["line", "Line", LineSegmentIcon],
  ["arrow", "Arrow", ArrowUpRightIcon],
  ["eraser", "Eraser", EraserIcon],
]
const COLORS = [
  ["Red", "#ef4444"],
  ["Yellow", "#facc15"],
  ["Green", "#22c55e"],
  ["Blue", "#3b82f6"],
  ["Black", "#000000"],
  ["White", "#ffffff"],
] as const
const NEEDS_COLOR = new Set<Tool>(["highlight", "underline", "strike", "text", "pen", "rect", "ellipse", "line", "arrow"])
const NEEDS_WIDTH = new Set<Tool>(["text", "pen", "rect", "ellipse", "line", "arrow"])

const b64 = (bytes: Uint8Array) => {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export function PdfEditor({
  name,
  src,
  author,
  onSave,
  onClose,
}: {
  name: string
  // The PDF's bytes, from a preview URL.
  src: string
  author?: string
  // null: saved (the host closes this). A string: what went wrong. PDF_CHANGED: ask what to do.
  onSave: (file: File, as: "version" | "copy", overwrite: boolean) => Promise<string | null>
  onClose: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const ed = useRef<Editor | null>(null)
  const [st, setSt] = useState<EditorState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<"version" | "copy" | null>(null)
  const [pending, setPending] = useState<File | null>(null)
  const [color, setColor] = useState("#ef4444")
  const [width, setWidth] = useState(3)
  const [zoom, setZoom] = useState(1)
  const [saved, setSaved] = useState<SignaturesResponse>({ signature: null, initials: null })
  const [making, setMaking] = useState<SignatureKind | null>(null)

  const tool = st?.tool ?? "select"
  const dirty = st?.dirty ?? false

  useEffect(() => {
    let dead = false
    let editor: Editor | null = null
    ;(async () => {
      try {
        const pdfjs = await import("pdfjs-dist")
        pdfjs.GlobalWorkerOptions.workerSrc ||= new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
        const res = await fetch(src)
        if (!res.ok) throw new Error("fetch")
        const data = new Uint8Array(await res.arrayBuffer())
        if (dead || !host.current) return
        editor = await Editor.open({ container: host.current, pdfjs, data, author, onChange: setSt })
        if (dead) return editor.destroy()
        host.current.tabIndex = 0
        ed.current = editor
        editor.setColor(color)
        editor.setWidth(width)
      } catch (e) {
        if (!dead)
          setError(
            /encrypt|password/i.test(String((e as Error)?.message ?? e))
              ? "This PDF is password-protected, so it can't be edited here."
              : "Couldn't open this PDF for editing."
          )
      }
    })()
    fetch("/api/v1/signatures")
      .then((r) => (r.ok ? (r.json() as Promise<SignaturesResponse>) : null))
      .then((s) => s && !dead && setSaved(s))
      .catch(() => {})
    return () => {
      dead = true
      ed.current = null
      editor?.destroy()
    }
    // Opens once per file; colour and width are pushed in by their own handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty])

  function close() {
    if (dirty && !window.confirm("Discard your changes to this PDF?")) return
    onClose()
  }

  function pick(t: Tool) {
    // Highlighter starts yellow, the rest red, unless the person already chose.
    ed.current?.setTool(t)
    if (t === "highlight" && color === "#ef4444") paint("#facc15")
    else if (t !== "highlight" && color === "#facc15" && MARKUP_RED.has(t)) paint("#ef4444")
  }
  function paint(c: string) {
    setColor(c)
    ed.current?.setColor(c)
  }

  async function save(as: "version" | "copy", overwrite = false, file?: File) {
    if (!ed.current || saving) return
    setSaving(as)
    setError(null)
    try {
      const f = file ?? new File([(await ed.current.save()) as BlobPart], name, { type: "application/pdf" })
      const r = await onSave(f, as, overwrite)
      if (r === PDF_CHANGED) setPending(f)
      else if (r) setError(r)
    } catch {
      setError("Couldn't save the PDF. Try again.")
    }
    setSaving(null)
  }

  async function keepSignature(kind: SignatureKind, png: Uint8Array) {
    const r = await fetch("/api/v1/signatures", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, png: b64(png) }),
    }).catch(() => null)
    if (r?.ok) setSaved((s) => ({ ...s, [kind]: b64(png) }))
    else setError("Couldn't save it to your account, but you can still place it.")
  }

  function place(kind: SignatureKind) {
    const png = saved[kind]
    if (png) ed.current?.setStamp(unb64(png))
    else setMaking(kind)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // The editor handles its own keys while it has focus.
    if (host.current?.contains(e.target as Node) || e.target instanceof HTMLInputElement) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault()
      return e.shiftKey ? ed.current?.redo() : ed.current?.undo()
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") ed.current?.redo()
  }

  const ready = Boolean(st)

  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[60] bg-black" />
        <Dialog.Popup onKeyDown={onKeyDown} className="fixed inset-0 z-[60] flex flex-col bg-background outline-none">
          <header className="flex h-14 shrink-0 items-center gap-1.5 border-b px-2 sm:gap-2 sm:px-3">
            <Button variant="ghost" size="icon" aria-label="Close editor" onClick={close}>
              <XIcon className="size-5" />
            </Button>
            <Dialog.Title className="min-w-0 truncate text-sm font-medium max-sm:sr-only">Edit {name}</Dialog.Title>
            <div className="ml-auto flex items-center gap-1.5">
              <Button variant="ghost" size="icon" aria-label="Undo" title="Undo" disabled={!st?.canUndo} onClick={() => ed.current?.undo()}>
                <ArrowUUpLeftIcon className="size-5" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Redo" title="Redo" disabled={!st?.canRedo} onClick={() => ed.current?.redo()}>
                <ArrowUUpRightIcon className="size-5" />
              </Button>
              <Button variant="outline" disabled={!ready || !!saving} onClick={() => save("copy")}>
                {saving === "copy" ? "Saving…" : "Save as copy"}
              </Button>
              <Button disabled={!ready || !!saving} onClick={() => save("version")}>
                {saving === "version" ? "Saving…" : "Save"}
              </Button>
            </div>
          </header>

          <div className="relative min-h-0 flex-1">
            <div
              ref={host}
              aria-label="PDF pages"
              className="absolute inset-0 overflow-auto overscroll-contain outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-inset"
            />
            {!ready && !error && (
              <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-white/80">Opening…</p>
            )}
          </div>

          {error && (
            <p role="alert" className="border-t bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="shrink-0 border-t">
            <div className="flex min-h-14 items-center gap-x-4 overflow-x-auto px-2 py-2 sm:px-3">
              <div role="group" aria-label="Tools" className="flex shrink-0 items-center gap-0.5">
                {TOOLS.map(([t, label, Icon]) => (
                  <Button
                    key={t}
                    variant={tool === t ? "secondary" : "ghost"}
                    size="icon"
                    aria-label={label}
                    title={label}
                    aria-pressed={tool === t}
                    disabled={!ready}
                    onClick={() => pick(t)}
                  >
                    <Icon className="size-5" />
                  </Button>
                ))}
                <Menu.Root>
                  <Menu.Trigger
                    render={<Button variant={tool === "stamp" ? "secondary" : "ghost"} size="icon" aria-label="Sign" title="Sign" disabled={!ready} />}
                  >
                    <SignatureIcon className="size-5" />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner side="top" align="start" sideOffset={8} className="z-[70]">
                      <Menu.Popup className={cn(MENU_POPUP, "w-60")}>
                        <Menu.Item onClick={() => place("signature")} className={MENU_ITEM}>
                          {saved.signature ? "Place my signature" : "Add my signature…"}
                        </Menu.Item>
                        <Menu.Item onClick={() => place("initials")} className={MENU_ITEM}>
                          {saved.initials ? "Place my initials" : "Add my initials…"}
                        </Menu.Item>
                        {(saved.signature || saved.initials) && <Menu.Separator className="-mx-1 my-1 h-px bg-border" />}
                        {saved.signature && (
                          <Menu.Item onClick={() => setMaking("signature")} className={MENU_ITEM}>
                            Change my signature…
                          </Menu.Item>
                        )}
                        {saved.initials && (
                          <Menu.Item onClick={() => setMaking("initials")} className={MENU_ITEM}>
                            Change my initials…
                          </Menu.Item>
                        )}
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              </div>

              {NEEDS_COLOR.has(tool) && (
                <div role="radiogroup" aria-label="Colour" className="flex shrink-0 items-center gap-1.5">
                  {COLORS.map(([label, hex]) => (
                    <button
                      key={hex}
                      type="button"
                      role="radio"
                      aria-checked={color === hex}
                      aria-label={label}
                      title={label}
                      onClick={() => paint(hex)}
                      className={cn(
                        "grid size-8 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60",
                        color === hex && "bg-muted"
                      )}
                    >
                      <span className="size-5 rounded-full border border-white/30" style={{ background: hex }} />
                    </button>
                  ))}
                </div>
              )}
              {NEEDS_WIDTH.has(tool) && (
                <label className="flex shrink-0 items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{tool === "text" ? "Size" : "Width"}</span>
                  <input
                    type="range"
                    min={1}
                    max={tool === "text" ? 8 : 12}
                    step={0.5}
                    value={width}
                    aria-label={tool === "text" ? "Text size" : "Stroke width"}
                    onChange={(e) => {
                      setWidth(Number(e.target.value))
                      ed.current?.setWidth(Number(e.target.value))
                    }}
                    className="h-1.5 w-28 accent-[var(--brand)]"
                  />
                </label>
              )}
              {tool === "stamp" && <p className="shrink-0 text-sm text-muted-foreground">Tap the page where it goes.</p>}
              {tool === "select" && !st?.selected && (
                <p className="shrink-0 text-sm text-muted-foreground">Fill in fields, or tap a mark to move it.</p>
              )}
              {st?.selected && (
                <Button variant="ghost" size="sm" onClick={() => ed.current?.deleteSelected()}>
                  <TrashIcon className="size-4" />
                  Delete
                </Button>
              )}

              <div role="group" aria-label="Zoom" className="ml-auto flex shrink-0 items-center gap-0.5 max-sm:hidden">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Zoom out"
                  title="Zoom out"
                  disabled={zoom <= 0.5}
                  onClick={() => {
                    const z = Math.max(0.5, zoom - 0.25)
                    setZoom(z)
                    ed.current?.setZoom(z)
                  }}
                >
                  <MagnifyingGlassMinusIcon className="size-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Zoom in"
                  title="Zoom in"
                  disabled={zoom >= 3}
                  onClick={() => {
                    const z = Math.min(3, zoom + 0.25)
                    setZoom(z)
                    ed.current?.setZoom(z)
                  }}
                >
                  <MagnifyingGlassPlusIcon className="size-5" />
                </Button>
              </div>
            </div>
          </div>

          {making && (
            <SignatureDialog
              kind={making}
              onClose={() => setMaking(null)}
              onDone={(png, keep) => {
                const kind = making
                setMaking(null)
                if (keep) void keepSignature(kind, png)
                ed.current?.setStamp(png)
              }}
            />
          )}

          {pending && (
            <Dialog.Root open onOpenChange={(o) => !o && setPending(null)}>
              <Dialog.Portal>
                <Dialog.Backdrop className={cn(DIALOG_BACKDROP, "z-[70]")} />
                <Dialog.Popup className={cn(DIALOG_POPUP, "z-[70]")}>
                  <div className="grid gap-1.5">
                    <Dialog.Title className="text-base font-semibold">This file changed while you were editing</Dialog.Title>
                    <Dialog.Description className="text-sm text-muted-foreground">
                      Someone saved a newer version. Overwrite adds yours on top as the newest version; theirs stays in Versions.
                      Save as copy keeps both files.
                    </Dialog.Description>
                  </div>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Dialog.Close render={<Button variant="ghost" className="sm:mr-auto" />}>Cancel</Dialog.Close>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const f = pending
                        setPending(null)
                        void save("copy", false, f)
                      }}
                    >
                      Save as copy
                    </Button>
                    <Button
                      onClick={() => {
                        const f = pending
                        setPending(null)
                        void save("version", true, f)
                      }}
                    >
                      Overwrite
                    </Button>
                  </div>
                </Dialog.Popup>
              </Dialog.Portal>
            </Dialog.Root>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Tools whose default is the red pen, as opposed to the yellow highlighter.
const MARKUP_RED = new Set<Tool>(["underline", "strike", "text", "pen", "rect", "ellipse", "line", "arrow"])
