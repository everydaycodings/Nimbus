// The PDF editor's rules: when Edit shows, the toolbar's tools and defaults, what to do when the file moved on,
// and the messages between the app and the editor page (viewer/pdf-edit.ts). No React or native imports, so node --test can run it.
import { previewKind } from "@nimbus/shared/file-rules"

export const PDF_EDIT_MAX_DEFAULT = 100 * 1024 ** 2

// Own files and files shared with edit rights; not a link, an older version or a Vault file; not over the admin's size cap.
// `max` is /instance's maxPdfEditBytes; an older server doesn't send it, so the default applies.
export function canEditPdf(file: { name: string; mime: string | null; size: number }, ctx: { editable: boolean; vault: boolean; version: boolean; max?: number }) {
  return ctx.editable && !ctx.vault && !ctx.version && previewKind(file.mime, file.name) === "pdf" && file.size <= (ctx.max ?? PDF_EDIT_MAX_DEFAULT)
}

// ---- Toolbar ----

export type Tool = "select" | "highlight" | "underline" | "strike" | "note" | "text" | "pen" | "rect" | "ellipse" | "line" | "arrow" | "eraser" | "stamp"

// Same order and wording as the web's toolbar (the Sign tool is added by the screen).
export const TOOLS: { tool: Tool; label: string }[] = [
  { tool: "select", label: "Select and fill in" },
  { tool: "highlight", label: "Highlight" },
  { tool: "underline", label: "Underline" },
  { tool: "strike", label: "Strike out" },
  { tool: "note", label: "Sticky note" },
  { tool: "text", label: "Text" },
  { tool: "pen", label: "Pen" },
  { tool: "rect", label: "Rectangle" },
  { tool: "ellipse", label: "Ellipse" },
  { tool: "line", label: "Line" },
  { tool: "arrow", label: "Arrow" },
  { tool: "eraser", label: "Eraser" },
]
export const COLORS = [
  { label: "Red", hex: "#ef4444" },
  { label: "Yellow", hex: "#facc15" },
  { label: "Green", hex: "#22c55e" },
  { label: "Blue", hex: "#3b82f6" },
  { label: "Black", hex: "#000000" },
  { label: "White", hex: "#ffffff" },
]
export const RED = "#ef4444"
export const YELLOW = "#facc15"
export const needsColor = (t: Tool) => t === "highlight" || t === "underline" || t === "strike" || t === "text" || t === "pen" || t === "rect" || t === "ellipse" || t === "line" || t === "arrow"
export const needsWidth = (t: Tool) => t === "text" || t === "pen" || t === "rect" || t === "ellipse" || t === "line" || t === "arrow"
export const widthRange = (t: Tool) => ({ min: 1, max: t === "text" ? 8 : 12, step: 0.5 })

// Highlighter starts yellow and the rest red, unless the person already chose another colour.
export function colorFor(tool: Tool, current: string) {
  if (tool === "highlight" && current === RED) return YELLOW
  if (tool !== "highlight" && current === YELLOW && needsColor(tool)) return RED
  return current
}

// ---- Saving ----

export type Choice = "save" | "ask"

// A new version over a file someone else saved in the meantime needs a choice first; a copy, or Overwrite, never does.
export const saveChoice = (as: "version" | "copy", overwrite: boolean, opened: string | null | undefined, now: string | null) =>
  as === "version" && !overwrite && opened !== undefined && opened !== now ? "ask" : "save"

// Same words as the web's dialog.
export const CHANGED_TITLE = "This file changed while you were editing"
export const CHANGED_BODY = "Someone saved a newer version. Overwrite adds yours on top as the newest version; theirs stays in Versions. Save as copy keeps both files."

// ---- Messages ----
// App to page (window.__cmd): {c:"tool",v} {c:"color",v} {c:"width",v} {c:"undo"} {c:"redo"} {c:"delete"} {c:"stamp",b64} {c:"save",id}.
// Page to app: {t:"read",id,offset,length} (bytes of the file, answered with __reply), {t:"ready"}, {t:"error",message},
// {t:"state",s:EditorState}, then for a save {t:"part",id,i,b64}* and {t:"saved",id,parts,size}, or {t:"saveError",id}.

export type EditorState = { dirty: boolean; canUndo: boolean; canRedo: boolean; tool: Tool; selected: string | null; pages: number }
export type Cmd =
  | { c: "tool"; v: Tool }
  | { c: "color"; v: string }
  | { c: "width"; v: number }
  | { c: "undo" | "redo" | "delete" }
  | { c: "stamp"; b64: string }
  | { c: "save"; id: number }

// Runs inside the page; the trailing `true` is what injectJavaScript asks for.
export const cmdScript = (cmd: Cmd) => `__cmd(${JSON.stringify(cmd)});true;`

export type Msg =
  | { t: "read"; id: number; offset: number; length: number }
  | { t: "ready" }
  | { t: "error"; message?: string; detail?: string }
  | { t: "state"; s: EditorState }
  | { t: "part"; id: number; i: number; b64: string }
  | { t: "saved"; id: number; parts: number; size: number }
  | { t: "saveError"; id: number; detail?: string }

export function parseMsg(raw: string): Msg | null {
  try {
    const m = JSON.parse(raw)
    if (!m || typeof m.t !== "string") return null
    switch (m.t) {
      case "read":
        return Number.isFinite(m.id) && Number.isFinite(m.offset) && Number.isFinite(m.length) ? m : null
      case "state":
        return m.s && typeof m.s.tool === "string" ? m : null
      case "part":
        return typeof m.b64 === "string" && Number.isFinite(m.id) && Number.isFinite(m.i) ? m : null
      case "saved":
        return Number.isFinite(m.id) && Number.isFinite(m.parts) && Number.isFinite(m.size) ? m : null
      case "ready":
      case "error":
      case "saveError":
        return m
    }
  } catch {}
  return null
}

// A save's parts arrive in order; this says whether every one did and the file is as long as the page said.
export const saveComplete = (parts: number, got: number, size: number, written: number) => parts === got && size === written

// ---- Signature pad (viewer/signature.ts) ----
export type PadCmd =
  | { c: "mode"; v: "draw" | "type" | "upload" }
  | { c: "ink" | "font" | "text"; v: string }
  | { c: "clear" }
  | { c: "image"; b64: string }
  | { c: "export"; id: number }
export const padScript = (cmd: PadCmd) => `__cmd(${JSON.stringify(cmd)});true;`

export const INKS = [
  { label: "Black", hex: "#111827" },
  { label: "Blue", hex: "#1d4ed8" },
]
export const HANDWRITING = ["Caveat", "Dancing Script", "Great Vibes"]
// The API takes up to 300 KB per signature.
export const SIGNATURE_MAX_BYTES = 300 * 1024
