// Tiny server implementing CONTRACT.md. `node test/mock.mjs [port]` for manual/Go smoke runs.
import { createServer } from "node:http"

export function startMock(port = 0) {
  const state = {
    version: 1,
    locked: false,
    polls: 0,
    secrets: [
      { key: "DB_URL", value: "postgres://u:p@h/db", type: "url", comment: "" },
      { key: "GREETING", value: 'hi "there"\nline2 #x', type: "string", comment: "multiline" },
    ],
  }
  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { "content-type": "application/json", ...headers })
    res.end(body === undefined ? undefined : JSON.stringify(body))
  }
  const err = (res, code, c, message, extra = {}) => send(res, code, { error: { code: c, message }, ...extra })
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://x")
    const p = u.pathname.replace("/api/v1/secrets", "")
    let body = ""
    for await (const c of req) body += c
    if (p === "/auth/device/start") return send(res, 200, { userCode: "ABCD-1234", verifyUrl: "http://x/verify", pollToken: "pt", expiresIn: 30, interval: 0.1 })
    if (p === "/auth/device/poll")
      return ++state.polls < 2 ? send(res, 202, { status: "pending" }) : send(res, 200, { token: "nms_test", user: { email: "a@b.c" } })
    const auth = req.headers.authorization
    if (auth !== "Bearer nms_test") return err(res, 401, "unauthorized", "bad token")
    if (p === "/auth/logout") return send(res, 204)
    if (p === "/whoami") return send(res, 200, { type: "user", name: "A", email: "a@b.c" })
    if (state.locked && p.startsWith("/secrets")) return err(res, 423, "locked", "locked", { unlockUrl: "http://x/secrets" })
    if (p === "/projects") return send(res, 200, { projects: [{ id: "1", slug: "web", name: "Web" }] })
    if (p === "/projects/web/envs") return send(res, 200, { envs: [{ slug: "dev", name: "Development" }] })
    if (p === "/secrets/version") return send(res, 200, { version: state.version, etag: `"${state.version}"` })
    if (p === "/secrets/watch") {
      const since = Number(u.searchParams.get("version"))
      const end = Date.now() + Number(u.searchParams.get("timeout") || 25) * 1000
      const t = setInterval(() => {
        if (state.version !== since || Date.now() > end) {
          clearInterval(t)
          send(res, 200, { version: state.version, changed: state.version !== since })
        }
      }, 50)
      return
    }
    if (p === "/secrets") {
      if (u.searchParams.get("env") !== "dev") return err(res, 404, "not_found", "no such env")
      const etag = `"${state.version}"`
      if (req.headers["if-none-match"] === etag) return send(res, 304)
      return send(res, 200, state.secrets, { etag, "x-secrets-version": String(state.version) })
    }
    err(res, 404, "not_found", "nope")
  })
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve({ state, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }))
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = await startMock(Number(process.argv[2] || 0))
  console.log(m.url)
}
