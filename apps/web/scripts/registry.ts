// Container registry front door (OCI distribution-spec). Next can't route the
// raw /v2/… paths and odd verbs clients send, so this forwards every request to
// /api/registry as a POST carrying the real method and URL, plus a short-lived
// proof. Bodies (layers!) stream both ways.
import http from "node:http"

import { signToken } from "../lib/upload-rules.ts"

const app = new URL(process.env.REGISTRY_APP_URL ?? process.env.WEBDAV_APP_URL ?? "http://localhost:3000")
const port = Number(process.env.REGISTRY_PORT ?? 3408)

http
  .createServer((req, res) => {
    const headers = { ...req.headers }
    delete headers.expect
    delete headers.connection
    headers["x-cr-host"] = req.headers.host ?? ""
    headers.host = app.host
    headers["x-cr-method"] = req.method
    headers["x-cr-url"] = req.url ?? "/"
    if (req.headers.expect) headers["x-cr-expect"] = req.headers.expect
    headers["x-cr-proxy"] = signToken("registry", {}, 60_000)
    // nginx's X-Real-IP, which clients can't set, or the socket without nginx.
    headers["x-cr-ip"] = String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "")
    const up = http.request(
      { hostname: app.hostname, port: app.port || 80, method: "POST", path: "/api/registry", headers },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers)
        // The app answered a POST, so a HEAD's Content-Length has no body behind it.
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
  .listen(port, () => console.log(`Registry on :${port} → ${app.origin}`))
