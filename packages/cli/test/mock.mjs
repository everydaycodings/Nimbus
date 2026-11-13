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
    if (p === "/kms/keys") return send(res, 200, { keys: [{ name: "pay", kind: "aes", state: "enabled", latest: 2 }] })
    if (p.startsWith("/kms/") && req.method === "POST") {
      const b = JSON.parse(body || "{}")
      state.lastKms = { op: p.slice(5), ...b }
      if (b.key !== "pay") return err(res, 404, "not_found", "No key by that name in this project.")
      if (p === "/kms/encrypt") return send(res, 200, { ciphertext: "nkms:v1:pay:2:" + b.data, version: 2 })
      if (p === "/kms/decrypt") return send(res, 200, { data: b.ciphertext.split(":").pop(), version: 2 })
      if (p === "/kms/sign") return send(res, 200, { signature: "nkms:v1:pay:2:sig-" + b.data, version: 2 })
      if (p === "/kms/verify") return send(res, 200, { valid: b.signature === "nkms:v1:pay:2:sig-" + b.data, version: 2 })
    }
    if (p === "/dynamic" && req.method === "POST") {
      const b = JSON.parse(body || "{}")
      if (b.connection !== "orders-db") return err(res, 404, "not_found", "No connection called " + b.connection)
      state.lastTtl = b.ttl
      return send(res, 200, { leaseId: "L1", username: "nim_abc", password: "pw1", host: "db", port: 5432, database: "app", url: "postgres://nim_abc:pw1@db:5432/app", expiresAt: "2030-01-01T00:00:00.000Z", engine: "postgres" })
    }
    if (p === "/dynamic" && req.method === "DELETE") return send(res, 200, {})
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
