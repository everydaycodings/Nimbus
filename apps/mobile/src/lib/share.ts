import type { LinkInfo } from "@nimbus/shared/api"

export const linkUrl = (server: string, link: Pick<LinkInfo, "token">) => `${server}/s/${link.token}`

const live = (l: Pick<LinkInfo, "expiresAt">, now: number) => !l.expiresAt || Date.parse(l.expiresAt) > now

// What Copy link hands out. The server lists links oldest first; one with no
// password is easier to send, so it wins over a newer one that has one.
export function pickLink(links: LinkInfo[], now = Date.now()) {
  const usable = links.filter((l) => l.allowView && live(l, now)).reverse()
  return usable.find((l) => !l.hasPassword) ?? usable[0] ?? null
}

// The web's line under a link's name.
export function linkSummary(l: LinkInfo, now = Date.now()) {
  const until = l.expiresAt && (live(l, now) ? `Until ${new Date(l.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}` : "Expired")
  const parts = [
    until,
    !l.allowView && "Uploads only",
    l.allowView && !l.allowDownload && "No download",
    l.allowUpload && l.allowView && "Takes uploads",
    l.allowUpload && l.perVisitorFolder && "Folder per person",
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : "Anyone with the link"
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\bOPR\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/.*Safari\//, "Safari"],
]
const SYSTEMS: [RegExp, string][] = [
  [/Android/, "Android"],
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Windows/, "Windows"],
  [/Macintosh|Mac OS X/, "Mac"],
  [/CrOS/, "ChromeOS"],
  [/Linux|X11/, "Linux"],
]

// "Chrome on Android". Null when it's not a browser we can name; the raw text is a tap away.
export function describeUa(ua: string | null) {
  if (!ua) return null
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1]
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1]
  return browser && system ? `${browser} on ${system}` : (browser ?? system ?? null)
}

export const EVENT: Record<string, string> = {
  view: "Opened",
  download: "Downloaded",
  upload: "Uploaded",
  unlock_fail: "Wrong password",
  confirm: "Emailed a receipt to",
}
