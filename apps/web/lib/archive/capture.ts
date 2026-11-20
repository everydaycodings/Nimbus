// One capture: opens the page in the separate browser service over CDP and returns the four files' bytes.
// Single-file HTML is made here: stylesheets, images and fonts that the page loaded are put back inline as data URIs,
// scripts and event handlers are stripped. Reader text comes from @mozilla/readability.
import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import puppeteer from "puppeteer-core"

export const NAV_TIMEOUT = 45_000
const ASSET_MAX = 5 * 1024 * 1024
const ASSETS_TOTAL = 40 * 1024 * 1024
// A tall screenshot past this many pixels fails in Chromium, so the picture stops there.
const SHOT_MAX = 15_000

export type Captured = { title: string; html: string; pdf: Buffer; png: Buffer; text: string }
export type Cookie = { name: string; value: string }

// ponytail: the reachability probe and the capture share one URL; a pool of browsers is browserless' job (CONCURRENT).
export async function browserState(wsUrl: string | null): Promise<"off" | "down" | "ok"> {
  if (!wsUrl?.trim()) return "off"
  try {
    const u = new URL(wsUrl)
    u.protocol = u.protocol === "wss:" ? "https:" : "http:"
    u.pathname = "/json/version"
    const res = await fetch(u, { signal: AbortSignal.timeout(2500) })
    await res.body?.cancel()
    return res.ok ? "ok" : "down"
  } catch {
    return "down"
  }
}

// Runs inside the page (so it can't use anything from this file). `assets` maps a URL to [mime, base64] of what the
// page loaded. Works on a copy of the DOM, so the page is left as it was.
function inlinePage(assets: Record<string, [string, string]>, images: string[]): string {
  const base = document.baseURI
  const abs = (u: string, from?: string) => {
    try {
      return new URL(u, from || base).href
    } catch {
      return null
    }
  }
  const dataUri = (u: string | null) => (u && assets[u] ? `data:${assets[u][0]};base64,${assets[u][1]}` : null)
  const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
  const fixCss = (css: string, from: string) =>
    css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (m, _q: string, u: string) => {
      if (!u || /^(data:|#)/.test(u)) return m
      const a = abs(u, from)
      const d = dataUri(a)
      return d ? `url("${d}")` : a ? `url("${a}")` : m
    })

  const root = document.documentElement.cloneNode(true) as HTMLElement
  root.querySelectorAll("script,noscript,iframe,object,embed,base,link[rel~=preload],link[rel~=modulepreload],link[rel~=prefetch],link[rel~=manifest]").forEach((e) => e.remove())
  root.querySelectorAll("picture source").forEach((e) => e.remove())

  root.querySelectorAll("link[rel~=stylesheet]").forEach((l) => {
    const href = abs(l.getAttribute("href") || "")
    const css = href && assets[href] ? decode(assets[href][1]) : null
    if (css === null) return l.setAttribute("href", href || "")
    const s = document.createElement("style")
    s.textContent = fixCss(css, href!)
    l.replaceWith(s)
  })
  root.querySelectorAll("style").forEach((s) => (s.textContent = fixCss(s.textContent || "", base)))
  root.querySelectorAll("link[rel~=icon]").forEach((l) => {
    const href = abs(l.getAttribute("href") || "")
    l.setAttribute("href", dataUri(href) || href || "")
  })
  root.querySelectorAll("img").forEach((img, i) => {
    // The live image knows which candidate of a srcset the browser used.
    const src = images[i] || abs(img.getAttribute("src") || "") || ""
    img.setAttribute("src", dataUri(src) || src)
    img.removeAttribute("srcset")
    img.removeAttribute("sizes")
    img.removeAttribute("loading")
  })
  root.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || ""
    a.setAttribute("href", /^javascript:/i.test(href) ? "#" : abs(href) || "#")
  })
  root.querySelectorAll("*").forEach((el) => {
    for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name)) el.removeAttribute(a.name)
    const st = el.getAttribute("style")
    if (st && st.includes("url(")) el.setAttribute("style", fixCss(st, base))
  })

  const head = root.querySelector("head") || root.insertBefore(document.createElement("head"), root.firstChild)
  head.insertAdjacentHTML(
    "afterbegin",
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:; media-src data:"><meta name="archived-from" content="${base.replace(/"/g, "&quot;")}">`
  )
  return "<!doctype html>\n" + root.outerHTML
}

// Cookies go on the host and its subdomains.
export async function capture(wsUrl: string, url: string, cookies: Cookie[]): Promise<Captured> {
  const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl })
  try {
    const page = await browser.newPage()
    const host = new URL(url).hostname
    if (cookies.length) await page.setCookie(...cookies.map((c) => ({ ...c, domain: host, path: "/" })))
    await page.setViewport({ width: 1280, height: 800 })
    // Every request, redirects and page assets included, stays off cloud metadata services.
    // ponytail: matches the host as written, so a public name resolving to 169.254.x slips by; a resolving proxy closes that.
    await page.setRequestInterception(true)
    page.on("request", (r) => {
      let h = ""
      try {
        h = new URL(r.url()).hostname.replace(/^\[|\]$/g, "").toLowerCase()
      } catch {}
      if (/^169\.254\.|^fe80:|^fd00:ec2::254$|^metadata(\.google\.internal)?$/.test(h)) void r.abort("accessdenied")
      else void r.continue()
    })

    const assets: Record<string, [string, string]> = {}
    const reads: Promise<unknown>[] = []
    let total = 0
    page.on("response", (res) => {
      const kind = res.request().resourceType()
      if (!res.ok() || (kind !== "image" && kind !== "font" && kind !== "stylesheet")) return
      reads.push(
        res
          .buffer()
          .then((buf) => {
            if (buf.length > ASSET_MAX || total + buf.length > ASSETS_TOTAL) return
            total += buf.length
            const type = (res.headers()["content-type"] ?? "").split(";")[0].trim()
            assets[res.url()] = [type || (kind === "stylesheet" ? "text/css" : "application/octet-stream"), buf.toString("base64")]
          })
          .catch(() => {})
      )
    })

    const nav = await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT })
    if (nav && nav.status() >= 400) throw new Error(`The site answered ${nav.status()}.`)
    // Lazy images load as they scroll into view.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight && y < 30_000; y += 600) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 80))
      }
      window.scrollTo(0, 0)
    })
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => {})
    await Promise.allSettled(reads)

    const title = (await page.title()).trim()
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    const png = Buffer.from(
      height > SHOT_MAX
        ? await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1280, height: SHOT_MAX }, captureBeyondViewport: true })
        : await page.screenshot({ type: "png", fullPage: true })
    )
    const pdf = Buffer.from(await page.pdf({ printBackground: true, format: "A4" }))
    const html = await page.evaluate(inlinePage, assets, await page.evaluate(() => Array.from(document.images, (i) => i.currentSrc || i.src)))
    const text = readerText(await page.content(), url)
    return { title: title || text.title, html, pdf, png, text: text.body }
  } finally {
    await browser.close().catch(() => {})
  }
}

// The article text, as markdown-ish plain text. A page Readability can't read falls back to all its text.
function readerText(html: string, url: string): { title: string; body: string } {
  const { document } = parseHTML(html)
  const clean = (s: string) => s.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim()
  try {
    // linkedom has no base URL of its own.
    Object.defineProperty(document, "baseURI", { value: url })
    const art = new Readability(document as unknown as Document, { charThreshold: 50 }).parse()
    if (art?.content && (art.textContent ?? "").trim().length > 30) {
      // Paragraph ends become blank lines, so headings and paragraphs don't run together.
      const spaced = art.content.replace(/<\/(p|h[1-6]|li|div|blockquote|pre|tr)>|<br\s*\/?>/gi, "$&\n\n")
      return { title: (art.title ?? "").trim(), body: clean(parseHTML(`<html><body>${spaced}</body></html>`).document.body.textContent ?? "") }
    }
  } catch {}
  const { document: again } = parseHTML(html)
  again.querySelectorAll("script,style,noscript").forEach((e: Element) => e.remove())
  return { title: (again.title ?? "").trim(), body: clean(again.body?.textContent ?? "") }
}
