// File rules with no UI imports, so server code can use them too. lib/file-types.ts
// re-exports them next to the icons.

export const DOC =
  /\.(docx?|odt|rtf|txt|xlsx?|ods|csv|pptx?|odp|pages|numbers|key)$/i

const UNITS = ["B", "KB", "MB", "GB", "TB"]

export function formatBytes(n: number) {
  let i = 0
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024
    i++
  }
  return `${i ? n.toFixed(n < 10 ? 1 : 0) : n} ${UNITS[i]}`
}

const TEXT =
  /\.(txt|log|ini|conf|cfg|env|properties|c|h|cc|cpp|hpp|cs|css|scss|less|go|html?|java|js|mjs|cjs|json|jsx|kt|lua|php|pl|py|r|rb|rs|scala|sh|bash|zsh|sql|swift|toml|ts|tsx|vue|svelte|xml|ya?ml|graphql|proto|tf|dart|gradle|bat|ps1|diff|patch)$|(^|\/)(dockerfile|makefile|readme|license)$/i

export type PreviewKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "markdown"
  | "csv"
  | "text"
  | "zip"
  | "docx"
  | "sheet"

// Browsers label TypeScript as MPEG transport stream video.
// ponytail: real .ts video recordings show as code; sniff the bytes if that matters.
export const mimeOf = (mime: string | null, name: string) =>
  /\.(ts|tsx|mts|cts)$/i.test(name) ? "text/typescript" : (mime ?? "")

// Which viewer opens a file, or null when the browser can't show it.
export function previewKind(
  mime: string | null,
  name: string
): PreviewKind | null {
  const m = mimeOf(mime, name)
  if (m.startsWith("image/")) return "image"
  if (m.startsWith("video/")) return "video"
  if (m.startsWith("audio/")) return "audio"
  if (m === "application/pdf" || /\.pdf$/i.test(name)) return "pdf"
  if (/\.(md|markdown)$/i.test(name)) return "markdown"
  if (/\.(csv|tsv)$/i.test(name)) return "csv"
  if (/\.zip$/i.test(name)) return "zip"
  if (/\.docx$/i.test(name)) return "docx"
  if (/\.(xlsx|xlsm|xls|ods)$/i.test(name)) return "sheet"
  if (
    TEXT.test(name) ||
    m.startsWith("text/") ||
    /json|xml|javascript|yaml|toml/.test(m)
  )
    return "text"
  return null
}

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Temporary files apps make while saving over WebDAV (GNOME's
// .goutputstream-*, LibreOffice's .~lock.*# and lu*.tmp, Office's ~$*), swept
// after a day. Postgres reads the same patterns with ~*.
export const TEMP = String.raw`^(\.goutputstream-.*|\.~lock\..*#|~\$.*|lu\w+\.tmp)$`
// Those plus the ._name files macOS keeps beside each file (Finder tags and
// other metadata; Finder errors if they vanish). Kept so the apps work, hidden
// on the web, and never versioned.
export const JUNK = String.raw`^(\._.+|\.goutputstream-.*|\.~lock\..*#|~\$.*|lu\w+\.tmp)$`
export const isJunk = (name: string) => new RegExp(JUNK, "i").test(name)

// Folder metadata Macs and Windows write everywhere and never need back.
export const isDropped = (name: string) =>
  /^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(name)

// Files Collabora opens when an admin has set it up.
export const OFFICE_EXT =
  /\.(docx?|dotx?|odt|ott|rtf|xlsx?|xlsm|ods|ots|pptx?|ppsx?|odp|otp|odg)$/i

// Kinds the browser can draw a thumbnail of.
export const thumbable = (k: PreviewKind | null) =>
  k !== null && k !== "zip" && k !== "docx" && k !== "sheet"

// Lowercase, without the dot: "a.JPG" → "jpg". Dotfiles like ".env" have none.
export function extOf(name: string) {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

// The lowest free "name (n).ext". `taken` holds lowercased names.
export function freeName(name: string, taken: Set<string>, folder = false) {
  const dot = folder ? -1 : name.lastIndexOf(".")
  const [base, ext] =
    dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""]
  for (let n = 1; ; n++) {
    const next = `${base} (${n})${ext}`
    if (!taken.has(next.toLowerCase())) return next
  }
}

// "nimbus_files_2026-10-29_14-30-05.zip", in local time ("sv-SE" gives ISO-like order).
export const zipName = (base = "nimbus_files") =>
  `${base}_${new Date().toLocaleString("sv-SE").replace(" ", "_").replaceAll(":", "-")}.zip`
