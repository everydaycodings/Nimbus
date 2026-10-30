// WebDAV front door at /dav. Next can't route PROPFIND, MKCOL and friends, so
// this forwards every request to /api/dav as a POST carrying the real method
// and a short-lived signature. Bodies stream both ways.
import http from "node:http"

import { signToken } from "../lib/upload-rules.ts"

const app = new URL(process.env.WEBDAV_APP_URL ?? "http://localhost:3000")
const port = Number(process.env.WEBDAV_PORT ?? 3404)

http
  .createServer((req, res) => {
    const url = req.url ?? "/"
    const m = url.match(/^\/dav(\/[^?]*)?(\?.*)?$/)
    if (!m) return res.writeHead(404).end()
    // Next redirects a trailing slash away, so it never gets one.
    const path = "/api/dav" + (m[1] ?? "").replace(/\/+$/, "")
    const headers = { ...req.headers }
    delete headers.expect
    delete headers.connection
    headers.host = app.host
    headers["x-dav-method"] = req.method
    headers["x-dav-proxy"] = signToken("dav", {}, 60_000)
    // nginx's X-Real-IP, which clients can't set, or the socket without nginx.
    headers["x-dav-ip"] = String(headers["x-real-ip"] ?? req.socket.remoteAddress ?? "")
    const up = http.request(
      { hostname: app.hostname, port: app.port || 80, method: "POST", path, headers },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers)
        // The app answered a POST, so a HEAD's Content-Length has no body
        // behind it: send the headers and stop.
        if (req.method === "HEAD") {
          r.destroy()
          return res.end()
        }
        r.pipe(res)
      }
    )
    up.on("error", (e) => {
      console.error(`${new Date().toISOString()} ${req.method} ${url}: ${e.message}`)
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(up)
  })
  .listen(port, () => console.log(`WebDAV on :${port}/dav → ${app.origin}`))
