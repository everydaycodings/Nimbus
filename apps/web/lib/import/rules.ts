// Cloud Import's plain rules: no database, no rclone, so `node --test` can run them (rules.test.ts).

export const PROVIDERS = {
  gdrive: { label: "Google Drive", oauth: true },
  gphotos: { label: "Google Photos", oauth: true },
  dropbox: { label: "Dropbox", oauth: true },
  onedrive: { label: "OneDrive", oauth: true },
  s3: { label: "S3 storage", oauth: false },
  webdav: { label: "WebDAV", oauth: false },
  sftp: { label: "SFTP", oauth: false },
} as const
export type Provider = keyof typeof PROVIDERS

// The rclone backend name for each provider.
export const RCLONE_TYPE: Record<Provider, string> = { gdrive: "drive", gphotos: "google photos", dropbox: "dropbox", onedrive: "onedrive", s3: "s3", webdav: "webdav", sftp: "sftp" }

export type ImportOptions = {
  keepDates: boolean
  mirror: boolean
  // Google Drive only.
  sharedWithMe: boolean
  stars: boolean
  descriptions: boolean
}
export const DEFAULT_OPTIONS: ImportOptions = { keepDates: true, mirror: true, sharedWithMe: false, stars: false, descriptions: false }

export function cleanOptions(o: Partial<ImportOptions> | null | undefined): ImportOptions {
  return {
    keepDates: o?.keepDates ?? DEFAULT_OPTIONS.keepDates,
    mirror: o?.mirror ?? DEFAULT_OPTIONS.mirror,
    sharedWithMe: Boolean(o?.sharedWithMe),
    stars: Boolean(o?.stars),
    descriptions: Boolean(o?.descriptions),
  }
}

export const PRESETS = [
  [360, "6 hours"],
  [720, "12 hours"],
  [1440, "Daily"],
  [10_080, "Weekly"],
] as const
export const MIN_INTERVAL = 60
export const MAX_INTERVAL = 525_600

// ---- rclone config ----

// "[name]\nkey = value\n". A value with a newline would end the line early, so those are refused.
export function ini(name: string, fields: Record<string, string>) {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => {
      if (/[\r\n]/.test(v) || /[^\w.-]/.test(k)) throw new Error("A setting has a line break in it.")
      return `${k} = ${v}`
    })
  return `[${name}]\n${lines.join("\n")}\n`
}

// Reads one remote's options back out of a config file (rclone rewrites `token` after a refresh).
export function iniFields(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^([\w.-]+)\s*=\s*(.*)$/.exec(line)
    if (m) out[m[1]] = m[2]
  }
  return out
}

export type Token = { access_token: string; token_type: string; refresh_token?: string; expiry?: string }

// What an OAuth token answer becomes in rclone's token format.
export function rcloneToken(r: { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string }, now = Date.now()): Token | null {
  if (!r.access_token) return null
  return {
    access_token: r.access_token,
    token_type: r.token_type && /^bearer$/i.test(r.token_type) ? "Bearer" : (r.token_type ?? "Bearer"),
    ...(r.refresh_token && { refresh_token: r.refresh_token }),
    expiry: new Date(now + (r.expires_in ?? 3600) * 1000).toISOString(),
  }
}

// `rclone authorize "drive"` prints the token between arrows and noise; take the first JSON object that has an access token.
export function parseTokenPaste(text: string): Token | null {
  for (let i = text.indexOf("{"); i >= 0; i = text.indexOf("{", i + 1)) {
    for (let j = text.lastIndexOf("}"); j > i; j = text.lastIndexOf("}", j - 1)) {
      try {
        const t = JSON.parse(text.slice(i, j + 1)) as Partial<Token>
        if (typeof t.access_token === "string" && t.access_token) return { token_type: "Bearer", ...t } as Token
      } catch {}
    }
  }
  return null
}

// ---- listings ----

export type LsEntry = {
  Path: string
  Name: string
  Size: number
  ModTime: string
  IsDir: boolean
  ID?: string
  Hashes?: Record<string, string>
  Metadata?: Record<string, string>
}

export function parseLs(stdout: string): LsEntry[] {
  const rows = JSON.parse(stdout || "[]") as LsEntry[]
  if (!Array.isArray(rows)) throw new Error("rclone listed something unexpected.")
  return rows
}

// "a/b/c" -> ["a","b","c"]; a segment that isn't a safe file name gets its slashes and control characters replaced.
export const segments = (path: string) => path.split("/").filter(Boolean).map((s) => s.replace(/[\\\u0000-\u001f]/g, "_").replace(/^\.+$/, "_").slice(0, 200))

export const joinPath = (...p: string[]) => p.filter(Boolean).join("/")

export const mtimeOf = (e: { ModTime?: string }) => {
  const t = e.ModTime ? Date.parse(e.ModTime) : NaN
  return Number.isFinite(t) && t > 0 ? new Date(t) : null
}

// ---- conflicts ----

export type Have = { size: number; sha256: string | null; etag: string | null; mtime: Date }

// "skip" when the copy already here is the same file: equal hash, or (no hash on either side) equal size and modified time
// within two seconds (some stores keep whole seconds only). Otherwise it is imported, under a free name if the name is taken.
export function sameFile(remote: LsEntry, have: Have): boolean {
  const h = remote.Hashes ?? {}
  if (h.sha256 && have.sha256) return h.sha256.toLowerCase() === have.sha256.toLowerCase()
  if (h.md5 && have.etag && !have.etag.includes("-")) return h.md5.toLowerCase() === have.etag.toLowerCase()
  const t = mtimeOf(remote)
  return remote.Size >= 0 && remote.Size === have.size && t !== null && Math.abs(t.getTime() - have.mtime.getTime()) < 2000
}

// A file this job already brought over: same size (when the source says) and modified time.
export function sameItem(remote: LsEntry, item: { size: number; mtime: Date | null }) {
  const t = mtimeOf(remote)
  const sized = remote.Size < 0 || remote.Size === item.size
  return sized && (t === null ? item.mtime === null : item.mtime !== null && Math.abs(t.getTime() - item.mtime.getTime()) < 2000)
}

// Seconds left, from the average speed so far; null until there is something to go on.
export function etaOf(done: number, total: number, startedMs: number, nowMs: number): number | null {
  const s = (nowMs - startedMs) / 1000
  if (done <= 0 || s < 3 || total <= done) return null
  return Math.round(((total - done) / done) * s)
}

// ---- Google Takeout ----

// Takeout shortens "photo.jpg.supplemental-metadata.json" to fit file name limits, in many ways.
const FULL = ".supplemental-metadata"
const TRUNC = new RegExp(`(${Array.from({ length: FULL.length - 3 }, (_, i) => FULL.slice(0, FULL.length - i).replace(/[.-]/g, "\\$&")).join("|")})$`)

// The media path a sidecar describes, lowercase, without ".json" ("a/img.jpg(1).json" -> "a/img.jpg(1)").
export function sidecarKey(jsonPath: string) {
  const [, head, dup = ""] = /^(.*?)(\(\d+\))?$/.exec(jsonPath.slice(0, -5))!
  return (head.replace(TRUNC, "") + dup).toLowerCase()
}

// Where a media file's sidecar may be: its own name, "img(1).jpg" -> "img.jpg(1)", and an edited copy uses the original's.
export function sidecarCandidates(mediaPath: string): string[] {
  const p = mediaPath.toLowerCase()
  const out = [p]
  const dup = /^(.*)\((\d+)\)(\.[^./]+)$/.exec(p)
  if (dup) out.push(`${dup[1]}${dup[3]}(${dup[2]})`)
  const edited = /^(.*)-edited(\.[^./]+)$/.exec(p)
  if (edited) out.push(`${edited[1]}${edited[2]}`)
  return out
}

export type Sidecar = { taken: Date | null; description: string; starred: boolean }

export function parseSidecar(text: string): Sidecar | null {
  try {
    const j = JSON.parse(text) as { photoTakenTime?: { timestamp?: string }; creationTime?: { timestamp?: string }; description?: string; favorited?: boolean }
    const s = Number(j.photoTakenTime?.timestamp ?? j.creationTime?.timestamp)
    return { taken: Number.isFinite(s) && s > 0 ? new Date(s * 1000) : null, description: String(j.description ?? "").trim(), starred: j.favorited === true }
  } catch {
    return null
  }
}

// A Takeout entry that is metadata, not a file to keep: a sidecar of a media entry in the zip, or an album's metadata.json.
export function isSidecar(path: string, media: Set<string>) {
  if (!/\.json$/i.test(path)) return false
  const low = path.toLowerCase()
  return low.includes(".supplemental-") || /(^|\/)metadata(\(\d+\))?\.json$/.test(low) || media.has(sidecarKey(path))
}

// Takeout puts everything under "Takeout/"; that folder adds nothing in Files.
export const takeoutDir = (entry: string) => segments(entry.replace(/^Takeout\//i, "")).slice(0, -1)

// Rows per page on the Items tab.
export const PAGE = 50
