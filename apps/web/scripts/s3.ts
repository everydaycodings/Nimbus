// S3-compatible front door. Next can't route the odd verbs and raw paths S3
// clients send, so this forwards every request to /api/s3 as a POST carrying
// the real method, the request exactly as received (the signature covers it)
// and a short-lived proof. Bodies stream both ways. Path-style only.
import http from "node:http"

import { signToken } from "../lib/upload-rules.ts"

const app = new URL(process.env.S3API_APP_URL ?? process.env.WEBDAV_APP_URL ?? "http://localhost:3000")
const port = Number(process.env.S3API_PORT ?? 3407)

http
  .createServer((req, res) => {
    const headers = { ...req.headers }
    delete headers.expect
    delete headers.connection
    headers["x-s3-host"] = req.headers.host ?? ""
    headers.host = app.host
    headers["x-s3-method"] = req.method
    headers["x-s3-url"] = req.url ?? "/"
    if (req.headers.expect) headers["x-s3-expect"] = req.headers.expect
    headers["x-s3-proxy"] = signToken("s3", {}, 60_000)
    // nginx's X-Real-IP, which clients can't set, or the socket without nginx.
    headers["x-s3-ip"] = String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "")
    // The raw path rides in x-s3-url, so what Next sees is always one plain path.
    const up = http.request(
      { hostname: app.hostname, port: app.port || 80, method: "POST", path: "/api/s3", headers },
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
      console.error(`${new Date().toISOString()} ${req.method} ${req.url}: ${e.message}`)
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(up)
  })
  .listen(port, () => console.log(`S3 API on :${port} → ${app.origin}`))
