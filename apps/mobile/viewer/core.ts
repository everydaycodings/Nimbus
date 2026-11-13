// What every viewer page shares: the byte bridge to the app and the messages back.
// These pages run in a WebView with no network and no file access (see scripts/build-viewers.ts).

// page: a PDF opens there, when a search found its words on it.
export type Meta = { name: string; size: number; top: number; bottom: number; page?: number }

declare global {
  interface Window {
    ReactNativeWebView: { postMessage(s: string): void }
    __reply(id: number, b64: string | null, error?: string): void
  }
}

export const meta: Meta = JSON.parse(document.querySelector<HTMLMetaElement>("meta[name=nimbus]")!.content)
document.documentElement.style.setProperty("--top", `${meta.top}px`)
document.documentElement.style.setProperty("--bottom", `${meta.bottom}px`)
export const post = (msg: Record<string, unknown>) => window.ReactNativeWebView.postMessage(JSON.stringify(msg))

// One chunk at a time, asked for by this side, so a large file can't flood the page with pending scripts.
const CHUNK = 1024 * 1024
const waiting = new Map<number, { ok: (b: Uint8Array) => void; no: (e: Error) => void }>()
let nextId = 1

window.__reply = (id, b64, error) => {
  const w = waiting.get(id)
  if (!w) return
  waiting.delete(id)
  if (b64 === null) return w.no(new Error(error ?? "Couldn't read this file."))
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  w.ok(out)
}

const chunk = (offset: number, length: number) =>
  new Promise<Uint8Array>((ok, no) => {
    const id = nextId++
    waiting.set(id, { ok, no })
    post({ t: "read", id, offset, length })
  })

export async function read(offset: number, length: number) {
  const out = new Uint8Array(length)
  let got = 0
  while (got < length) {
    const part = await chunk(offset + got, Math.min(CHUNK, length - got))
    if (!part.length) break
    out.set(part, got)
    got += part.length
  }
  return got === length ? out : out.subarray(0, got)
}

// Links can say anything, so the app decides what leaves. The WebView itself never navigates.
document.addEventListener("click", (e) => {
  const a = (e.target as Element).closest?.("a[href]")
  if (!a) return
  const href = a.getAttribute("href")!
  if (href.startsWith("#")) return
  e.preventDefault()
  if (/^(https?:|mailto:)/i.test(href)) post({ t: "link", url: href })
})

// The app's top bar hides as a document scrolls down and returns on the way up.
let lastY = 0
window.addEventListener(
  "scroll",
  () => {
    const y = window.scrollY
    if (Math.abs(y - lastY) < 12) return
    post({ t: "scroll", down: y > lastY && y > 24 })
    lastY = y
  },
  { passive: true }
)

// Nothing to scroll sideways: the app's pager takes horizontal swipes itself. Otherwise this page
// tells it to step aside, and a swipe that starts at the page's edge asks for the next file.
const SWIPE = 64
let overflowing: boolean | null = null
const checkOverflow = () => {
  const on = document.documentElement.scrollWidth > innerWidth + 1 || (visualViewport?.scale ?? 1) > 1.01
  if (on === overflowing) return
  overflowing = on
  post({ t: "overflow", on })
}
new ResizeObserver(checkOverflow).observe(document.documentElement)
visualViewport?.addEventListener("resize", checkOverflow)

let touch: { x: number; y: number; left: boolean; right: boolean } | null = null
addEventListener("touchstart", (e) => {
  if (e.touches.length > 1) return void (touch = null)
  const left = visualViewport?.pageLeft ?? scrollX
  const width = visualViewport?.width ?? innerWidth
  touch = {
    x: e.touches[0].clientX,
    y: e.touches[0].clientY,
    left: left <= 1,
    right: left + width >= document.documentElement.scrollWidth - 1,
  }
}, { passive: true })
addEventListener("touchend", (e) => {
  if (!touch || !overflowing) return
  const dx = e.changedTouches[0].clientX - touch.x
  const dy = e.changedTouches[0].clientY - touch.y
  if (Math.abs(dx) > SWIPE && Math.abs(dx) > 2 * Math.abs(dy) && (dx > 0 ? touch.left : touch.right)) post({ t: "edge", by: dx > 0 ? -1 : 1 })
  touch = null
}, { passive: true })

// Each viewer is one async function: it throws to show the app's error screen.
export function run(view: () => Promise<void>, fallback = "Couldn't open this file.") {
  view().then(
    () => {
      post({ t: "ready" })
      checkOverflow()
    },
    (e) => post({ t: "error", message: fallback, detail: String(e) })
  )
}

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}
