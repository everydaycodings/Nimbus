// What the previewer does with a file. No React or native imports, so it can be tested with node --test.
import { CSV_MAX, OFFICE_EXT, OFFICE_MAX, TEXT_MAX, previewKind } from "@nimbus/shared/file-rules"

export const CACHE_CAP = 500 * 1024 ** 2
export const DATA_WARNING = 25 * 1024 ** 2

export type Viewer = "pdf" | "docx" | "sheet" | "pptx" | "text" | "zip"

export type Plan =
  | { show: "image" | "video" | "audio" }
  // `cache`: fetch it whole first, then read locally. `range`: read pieces from storage as asked.
  // `bytes` is how much it'll fetch, which is what the mobile data warning is about.
  | { show: "web"; viewer: Viewer; fetch: "cache" | "range"; bytes: number }
  | { show: "collabora" }
  | { show: "none"; reason: string }

const TOO_BIG = { docx: "document", sheet: "spreadsheet", pptx: "presentation" } as const

export function planFor(name: string, mime: string | null, size: number): Plan {
  const kind = previewKind(mime, name)
  switch (kind) {
    case "image":
    case "video":
    case "audio":
      return { show: kind }
    case "docx":
    case "sheet":
    case "pptx":
      if (size > OFFICE_MAX) return { show: "none", reason: `This ${TOO_BIG[kind]} is too big to preview.` }
      return { show: "web", viewer: kind, fetch: "cache", bytes: size }
    case "pdf":
      return { show: "web", viewer: "pdf", fetch: size <= CACHE_CAP ? "cache" : "range", bytes: size }
    case "markdown":
    case "text":
      return { show: "web", viewer: "text", fetch: size <= TEXT_MAX ? "cache" : "range", bytes: Math.min(size, TEXT_MAX) }
    case "csv":
      return { show: "web", viewer: "sheet", fetch: size <= CSV_MAX ? "cache" : "range", bytes: Math.min(size, CSV_MAX) }
    case "zip":
      return { show: "web", viewer: "zip", fetch: "range", bytes: 0 }
    default:
      return OFFICE_EXT.test(name) ? { show: "collabora" } : { show: "none", reason: "Nimbus can't preview this type of file." }
  }
}

export const needsDataWarning = (plan: Plan, onMobileData: boolean, cached: boolean) =>
  plan.show === "web" && onMobileData && !cached && plan.bytes > DATA_WARNING

// Which cached files to remove, oldest first, so the rest fit the cap.
export function evictions<T extends { size: number; modified: number }>(files: T[], cap: number) {
  let total = files.reduce((n, f) => n + f.size, 0)
  const gone: T[] = []
  for (const f of [...files].sort((a, b) => a.modified - b.modified)) {
    if (total <= cap) break
    total -= f.size
    gone.push(f)
  }
  return gone
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

export function toBase64(bytes: Uint8Array) {
  const parts: string[] = []
  let line = ""
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    line += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
    if (line.length > 8192) {
      parts.push(line)
      line = ""
    }
  }
  const left = bytes.length - i
  if (left) {
    const n = (bytes[i] << 16) | (left === 2 ? bytes[i + 1] << 8 : 0)
    line += B64[n >> 18] + B64[(n >> 12) & 63] + (left === 2 ? B64[(n >> 6) & 63] : "=") + "="
  }
  parts.push(line)
  return parts.join("")
}
