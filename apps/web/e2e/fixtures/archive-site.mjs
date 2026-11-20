// A small website for the Website Archiver e2e: one article page with a stylesheet, an image and a script, whose
// text changes with `state.version`. Other paths (/b1, /b2, /other) are plain articles.
// Used from e2e/archive.spec.ts: `const site = await startSite(port)`; `site.state.version = 2` changes the page.
import { createServer } from "node:http"

// A 1x1 red PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64")

const article = (title, version) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/style.css"></head>
<body>
<article><h1 onclick="alert(1)">${title}</h1>
<p>This is version ${version} of the archive fixture page. It has enough words for the reader view to treat it as an article, and a few more so it does not give up.</p>
<p>Second paragraph: the quick brown fox jumps over the lazy dog, then does it again for good measure.</p>
<img src="/pic.png" alt="a red dot" width="40" height="40"></article>
<script>document.body.insertAdjacentHTML("beforeend", "<p id=ran>SCRIPT RAN</p>")</script>
</body></html>`

export async function startSite(port, host = "0.0.0.0") {
  const state = { version: 1 }
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname
    if (path === "/style.css") return res.writeHead(200, { "content-type": "text/css" }).end("body{font-family:sans-serif;background:#fffbe6} h1{color:#036} article{max-width:40em;margin:2em auto}")
    if (path === "/pic.png") return res.writeHead(200, { "content-type": "image/png" }).end(PNG)
    if (path === "/") return res.writeHead(200, { "content-type": "text/html" }).end(article("Archive fixture", state.version))
    if (path === "/missing") return res.writeHead(404).end("nope")
    return res.writeHead(200, { "content-type": "text/html" }).end(article(`Fixture ${path.slice(1)}`, 1))
  })
  await new Promise((r) => server.listen(port, host, r))
  return { state, close: () => new Promise((r) => server.close(r)) }
}
