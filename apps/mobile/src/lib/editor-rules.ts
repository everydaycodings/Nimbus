// The text editor's rules: what may be edited, undo history, find, and the save check. No React or native imports, so node --test can run it.
import { previewKind } from "@nimbus/shared/file-rules"

export const EDIT_MAX = 1024 ** 2

// Text, Markdown and code open in the editor; past the limit it's read-only.
export const canEdit = (name: string, mime: string | null) => {
  const k = previewKind(mime, name)
  return k === "text" || k === "markdown"
}
export const readOnly = (size: number) => size > EDIT_MAX

// Undo history: whole-text snapshots, which suit files up to 1 MB. The component commits after a pause in typing.
const HISTORY = 100
export type History = { stack: string[]; at: number }
export const history = (text: string): History => ({ stack: [text], at: 0 })
export const shown = (h: History) => h.stack[h.at]
export function commit(h: History, text: string): History {
  if (text === shown(h)) return h
  const stack = [...h.stack.slice(0, h.at + 1), text].slice(-HISTORY)
  return { stack, at: stack.length - 1 }
}
export const undo = (h: History): History => (h.at > 0 ? { ...h, at: h.at - 1 } : h)
export const redo = (h: History): History => (h.at < h.stack.length - 1 ? { ...h, at: h.at + 1 } : h)

// Where each match of `query` starts, ignoring case.
export function findAll(text: string, query: string) {
  const out: number[] = []
  if (!query) return out
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) out.push(i)
  return out
}

// The server's version when the editor opened vs now. A save over a different one would bury someone else's edit.
export const changedSince = (opened: string | null, now: string | null) => opened !== now
