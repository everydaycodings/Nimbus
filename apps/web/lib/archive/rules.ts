// Website Archiver, the pure parts: URLs, bookmarks.html, names, hashes. Relative imports only so node --test loads it.
import { createHash } from "node:crypto"

export const MAX_TAGS = 10
export const MAX_IMPORT = 1000
export const INTERVALS = [
  [null, "Never"],
  [1440, "Daily"],
  [10_080, "Weekly"],
] as const

// http(s) only; the address check is the capture's job.
export function cleanUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    if (u.username || u.password) return null
    return u.href
  } catch {
    return null
  }
}

export const siteOf = (url: string) => new URL(url).hostname.replace(/^www\./, "")

export function cleanTags(tags: Iterable<string>): string[] {
  const out: string[] = []
  for (const t of tags) {
    const v = t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 30)
    if (v && !out.includes(v)) out.push(v)
  }
  return out.slice(0, MAX_TAGS)
}

// "a, b" or "a b c" typed into a field.
export const splitTags = (s: string) => cleanTags(s.split(/[,\n]/))

// One URL per line (or space), duplicates dropped; `bad` are the lines that aren't web addresses.
export function parseUrlList(text: string): { urls: string[]; bad: string[] } {
  const urls: string[] = []
  const bad: string[] = []
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const u = cleanUrl(w)
    if (!u) bad.push(w)
    else if (!urls.includes(u)) urls.push(u)
  }
  return { urls, bad }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })

const ROOTS = new Set(["bookmarks", "bookmarks bar", "bookmarks menu", "bookmarks toolbar", "other bookmarks", "menu", "toolbar", "mobile bookmarks"])

// A Netscape bookmarks.html (Chrome, Firefox, Safari and Edge exports): each link with its TAGS= and its folders as tags.
export function parseBookmarks(html: string): { url: string; title: string; tags: string[] }[] {
  const out: { url: string; title: string; tags: string[] }[] = []
  const seen = new Set<string>()
  const stack: (string | null)[] = []
  let pending: string | null = null
  const re = /<(\/?)(h3|dl|a)\b([^>]*)>([^<]*)/gi
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const tag = m[2].toLowerCase()
    if (tag === "h3" && !m[1]) pending = decode(m[4]).trim()
    else if (tag === "dl") {
      if (m[1]) stack.pop()
      else {
        stack.push(pending)
        pending = null
      }
    } else if (tag === "a" && !m[1]) {
      const attr = (n: string) => decode(m![3].match(new RegExp(`\\b${n}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2, 4).find((x) => x !== undefined) ?? "")
      const url = cleanUrl(attr("href"))
      if (!url || seen.has(url)) continue
      seen.add(url)
      const folders = stack.filter((f): f is string => !!f && !ROOTS.has(f.toLowerCase()))
      out.push({ url, title: decode(m[4]).trim(), tags: cleanTags([...attr("tags").split(","), ...folders]) })
      if (out.length >= MAX_IMPORT) break
    }
  }
  return out
}

// What "unchanged" means: the same words, whatever the spacing.
export const textHash = (text: string) => createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex")

// A file name part from a page title: no path characters, no long runs.
export const safeName = (s: string, fallback = "page") => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim() || fallback

// "2026-11-20 1405", UTC.
export const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ").replace(":", "")

export const fileName = (title: string, at: Date, ext: string) => `${safeName(title)} (${stamp(at)}).${ext}`

// The cookie a page needs: cookies saved for the page's host or a parent domain of it.
export const cookieDomainFor = (host: string, domains: string[]) =>
  domains.filter((d) => host === d || host.endsWith(`.${d}`)).sort((a, b) => b.length - a.length)[0] ?? null

// "a=1; b=2" (a Cookie header) to name/value pairs.
export function parseCookieHeader(s: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = []
  for (const part of s.replace(/^cookie:\s*/i, "").split(";")) {
    const i = part.indexOf("=")
    const name = part.slice(0, i).trim()
    if (i > 0 && name) out.push({ name, value: part.slice(i + 1).trim() })
  }
  return out
}

// A domain typed by a person: "https://www.Example.com/x" becomes "example.com"; null when it isn't one.
export function cleanDomain(raw: string): string | null {
  const h = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#:].*$/, "").replace(/^(www|\*)?\./, "").replace(/^www\./, "")
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h) || h === "localhost" ? h : null
}
