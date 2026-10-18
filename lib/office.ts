// Optional Collabora (WOPI) viewer. The admin sets a URL the browser can reach;
// Collabora calls back into /api/wopi with a signed token. View only.
import "server-only"

import { appUrl } from "./email"
import { OFFICE_EXT } from "./file-rules"
import { getSettings } from "./signup"
import { readToken, signToken } from "./upload-rules"

const TTL = 10 * 60 * 60 * 1000

export type WopiToken = { u: string; n: string; v: string | null; exp: number }

export const signWopi = (userId: string, nodeId: string, v: string | null) =>
  signToken("wopi", { u: userId, n: nodeId, v }, TTL)

export function readWopi(token: unknown, nodeId: string) {
  const t = readToken<WopiToken>("wopi", token)
  return t && t.n === nodeId && t.exp > Date.now() ? t : null
}

// ponytail: discovery cached per process for an hour; restart to pick up a new Collabora.
let cache: { url: string; at: number; actions: Map<string, string> } | null =
  null

async function actions(url: string) {
  if (cache?.url === url && Date.now() - cache.at < 60 * 60 * 1000)
    return cache.actions
  const res = await fetch(`${url}/hosting/discovery`, {
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`discovery ${res.status}`)
  const xml = await res.text()
  // <action name="view" ext="docx" urlsrc="https://…/cool.html?"/>; prefer "view".
  const found = new Map<string, string>()
  for (const m of xml.matchAll(/<action\b[^>]*>/g)) {
    const tag = m[0]
    const ext = /\bext="([^"]+)"/.exec(tag)?.[1]
    const name = /\bname="([^"]+)"/.exec(tag)?.[1]
    const src = /\burlsrc="([^"]+)"/.exec(tag)?.[1]
    if (!ext || !src || (found.has(ext) && name !== "view")) continue
    found.set(ext, src.replaceAll("&amp;", "&"))
  }
  cache = { url, at: Date.now(), actions: found }
  return found
}

// Where Collabora reaches the app. Differs from the browser's origin when
// Collabora runs in Docker (http://host.docker.internal:3000 in dev).
const wopiBase = () => process.env.WOPI_BASE_URL || appUrl()

// The iframe's form target for this file, or null when Collabora is off,
// unreachable, or doesn't handle the extension.
export async function officeAction(name: string, nodeId: string) {
  const url = (await getSettings()).officeUrl
  if (!url || !OFFICE_EXT.test(name)) return null
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
  try {
    const src = (await actions(url)).get(ext)
    if (!src) return null
    const wopiSrc = encodeURIComponent(`${wopiBase()}/api/wopi/files/${nodeId}`)
    // urlsrc ends with placeholders like <ui=UI_LLCC&>; drop them.
    const base = src.replace(/<[^>]*>/g, "")
    return `${base}${/[?&]$/.test(base) ? "" : base.includes("?") ? "&" : "?"}WOPISrc=${wopiSrc}`
  } catch (e) {
    console.error("Collabora discovery failed:", e)
    return null
  }
}
