// share, webhooks and push against a small mock of CONTRACT.md. NIMBUS_CLI_BIN=<path> runs it against the Go binary.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

const CLI = new URL("../src/cli.ts", import.meta.url).pathname
const BIN = process.env.NIMBUS_CLI_BIN
const calls: { method: string; path: string; body: any }[] = []
let url = ""
const server = createServer(async (req, res) => {
  let raw = ""
  for await (const c of req) raw += c
  const path = req.url!.replace("/api/v1/secrets", "")
  const body = raw ? JSON.parse(raw) : undefined
  calls.push({ method: req.method!, path, body })
  const send = (code: number, b: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(b))
  const key = `${req.method} ${path}`
  if (req.headers.authorization !== "Bearer nmu_test") return send(401, { error: { code: "unauthorized", message: "bad token" } })
  if (key === "POST /shares") return send(200, { token: "ns_x", url: "http://x/s/ns_x" })
  if (key === "GET /shares") return send(200, { shares: [{ id: "s1", state: "active", views: 0, maxViews: 1, expiresAt: "2030-01-01T00:00:00.000Z", label: null }] })
  if (key === "DELETE /shares?id=s1") return send(200, { ok: true })
  const W = "/projects/web/envs/dev/webhooks"
  if (key === `GET ${W}`) return send(200, { hooks: [{ id: "h1", url: "https://a/hook", enabled: true }], deliveries: [] })
  if (key === `POST ${W}`) return send(200, { id: "h2", secret: "whsec_abc" })
  if (key === `DELETE ${W}/h1`) return send(200, { ok: true })
  if (key === `POST ${W}/h1/test`) return send(200, { status: "failed", httpStatus: 500, message: "The receiver answered 500." })
  if (key === "GET /projects/web/push") return send(200, { targets: [{ env: "dev", host: "box", port: 22, username: "deploy", path: "/srv/.env", auto: true, lastOk: true, lastMessage: "Wrote /srv/.env" }] })
  const P = "/projects/web/envs/dev/push"
  if (key === `PUT ${P}`) return send(200, { ok: true })
  if (key === `POST ${P}`) return send(502, { error: { code: "bad_gateway", message: "Couldn't reach box" } })
  if (key === `DELETE ${P}`) return send(200, { ok: true })
  send(404, { error: { code: "not_found", message: key } })
})
let home = ""
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  home = mkdtempSync(join(tmpdir(), "nimbus-gaps-"))
})
after(() => server.close())

const run = (args: string[], stdin?: string) =>
  new Promise<{ stdout: string; stderr: string; status: number | null }>((resolve) => {
    const env = { ...process.env, NIMBUS_SERVER: url, NIMBUS_TOKEN: "nmu_test", NIMBUS_CONFIG_DIR: join(home, "cfg") }
    const c = BIN ? spawn(BIN, args, { env, cwd: home }) : spawn(process.execPath, [CLI, ...args], { env, cwd: home })
    let stdout = "", stderr = ""
    c.stdout.on("data", (d) => (stdout += d))
    c.stderr.on("data", (d) => (stderr += d))
    c.on("close", (status) => resolve({ stdout, stderr, status }))
    c.stdin.end(stdin)
  })
const last = () => calls[calls.length - 1]

test("share: text, expiry, views, made-up password, stdin, list, revoke", async () => {
  const r = await run(["share", "db password", "--expires", "2h", "--views", "3", "--password"])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), "http://x/s/ns_x")
  assert.deepEqual({ ...last().body, password: undefined }, { text: "db password", minutes: 120, maxViews: 3, password: undefined })
  assert.ok(last().body.password.length >= 12)
  assert.match(r.stderr, new RegExp(`Password: ${last().body.password}`))
  await run(["share", "--expires=7d", "--password=pw"], "from stdin\n")
  assert.deepEqual(last().body, { text: "from stdin\n", minutes: 10080, maxViews: 1, password: "pw" })
  assert.equal((await run(["share", "--password", "oops", "text"])).status, 2)
  assert.equal((await run(["share", "x", "--expires", "soon"])).status, 2)
  assert.match((await run(["share", "list"])).stdout, /^s1\tactive\t0\/1\t/m)
  assert.equal((await run(["share", "revoke", "s1"])).status, 0)
})

test("webhooks: list, add shows the secret once, remove, a failed test exits 1", async () => {
  const E = ["--project", "web", "--env", "dev"]
  assert.match((await run(["webhooks", ...E])).stdout, /^h1\ton\thttps:\/\/a\/hook$/m)
  const add = await run(["webhooks", "add", "https://b/hook", ...E])
  assert.match(add.stdout, /whsec_abc/)
  assert.deepEqual(last().body, { url: "https://b/hook" })
  assert.equal((await run(["webhooks", "remove", "h1", ...E])).status, 0)
  const t = await run(["webhooks", "test", "h1", ...E])
  assert.equal(t.status, 1)
  assert.match(t.stdout, /500/)
  assert.equal((await run(["webhooks", "list", "--project", "web"])).status, 2)
})

test("push: list, set, run failure, remove", async () => {
  assert.match((await run(["push", "list", "--project", "web"])).stdout, /^dev\tdeploy@box:22\t\/srv\/.env\tauto\tok\t/m)
  const E = ["--project", "web", "--env", "dev"]
  assert.equal((await run(["push", "set", ...E, "--host", "box", "--user", "deploy", "--path", "/srv/.env", "--command", "systemctl restart app", "--auto"])).status, 0)
  assert.deepEqual(last().body, { host: "box", port: 22, username: "deploy", path: "/srv/.env", postCommand: "systemctl restart app", auto: true })
  assert.equal((await run(["push", "set", ...E, "--host", "box"])).status, 2)
  const r = await run(["push", "run", ...E])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /Couldn't reach box/)
  assert.equal((await run(["push", "remove", ...E])).status, 0)
  assert.equal(last().method, "DELETE")
})
