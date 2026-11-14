import { expect, test, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Redis } from "ioredis"
import { WebSocket } from "ws"

import { PASSWORD, signIn, unique } from "./helpers"

// Review R2: SSH, database drivers and outgoing connections.
// Needs the terminal sidecar (npm run ssh-terminal) and, for the jump-host test, two sshd
// containers on one Docker network where only the jump host has a port:
//   docker network create r2-net
//   docker run -d --name r2-jump --network r2-net -p 127.0.0.1:2240:2222 -e PUID=1000 -e PGID=1000 \
//     -e USER_NAME=tester -e PASSWORD_ACCESS=false lscr.io/linuxserver/openssh-server
//   docker run -d --name r2-inner --network r2-net -e PUID=1000 -e PGID=1000 \
//     -e USER_NAME=tester -e PASSWORD_ACCESS=false lscr.io/linuxserver/openssh-server
// Redis over TLS (E2E_REDIS_TLS_DIR holds ca.pem, server.pem, server.key; SAN 127.0.0.1):
//   docker run -d --name r2-redis-tls -p 127.0.0.1:63420:63420 -v $DIR:/tls:ro redis:7 redis-server --port 0 \
//     --tls-port 63420 --tls-cert-file /tls/server.pem --tls-key-file /tls/server.key \
//     --tls-ca-cert-file /tls/ca.pem --tls-auth-clients no --requirepass adminpw
const API = "/api/v1/secrets"
const TERM = process.env.E2E_SSH_TERMINAL ?? "ws://localhost:3406/ssh"
const JUMP_PORT = Number(process.env.E2E_JUMP_PORT ?? 2240)
const OWN_REDIS = Number(new URL(process.env.REDIS_URL ?? "redis://localhost:6380/0").port || 6379)
const db = (q: string) => execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()
const dx = (c: string, cmd: string) => execFileSync("docker", ["exec", c, "sh", "-c", cmd]).toString()
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", timeout: 30_000 })

async function unlock(page: Page) {
  await page.goto("/secrets")
  await page.getByLabel("Your Nimbus password").fill(PASSWORD)
  await page.getByRole("button", { name: "Unlock", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible()
}

async function project(page: Page, base: string) {
  const made = await (await page.request.post(`${API}/projects`, { data: { name: unique(base) } })).json()
  const detail = await (await page.request.get(`${API}/projects/${made.id}`)).json()
  return { id: made.id as string, dev: detail.envs.find((e: { slug: string }) => e.slug === "development").id as string }
}

// Opens a socket to the sidecar; resolves with the first message, "closed", or the HTTP status it was refused with.
function probe(origin: string | undefined, send: string[], waitMs = 3000) {
  return new Promise<string>((resolve) => {
    const ws = new WebSocket(TERM, origin ? { origin } : {})
    const t = setTimeout(() => (ws.terminate(), resolve("silent")), waitMs)
    ws.on("unexpected-response", (_req, res) => (clearTimeout(t), resolve(`http ${res.statusCode}`)))
    ws.on("error", () => {})
    ws.on("open", () => send.forEach((m) => ws.send(m)))
    ws.on("message", (d) => (clearTimeout(t), ws.close(), resolve(String(d))))
    ws.on("close", () => (clearTimeout(t), resolve("closed")))
  })
}

test("terminal sidecar: refuses a foreign Origin, survives junk messages, closes a socket that never opens", async () => {
  test.setTimeout(60_000)
  expect(await probe("https://evil.example", [])).toBe("http 403")
  // These used to throw inside the message handler and stop the whole sidecar.
  const junk = ["null", "7", '"x"', '{"type":"resize","rows":-1,"cols":"wide"}', '{"type":"open","ticket":{"a":1}}', '{"type":"open","ticket":"short"}']
  const reply = await probe("http://localhost:3000", [...junk, JSON.stringify({ type: "open", ticket: "A".repeat(32) })])
  expect(JSON.parse(reply)).toMatchObject({ type: "error", message: "That terminal link expired. Try again." })
  // Still up, and a plain client with no Origin still gets as far as the ticket check.
  expect(JSON.parse(await probe(undefined, [JSON.stringify({ type: "open", ticket: "B".repeat(32) })]))).toMatchObject({ type: "error" })
  // A socket that sends no ticket is closed after 10 seconds.
  expect(await probe("http://localhost:3000", [], 14_000)).toBe("closed")
})

test("webhooks stay off private addresses; database connections never reach Nimbus's own Redis; a moved host needs the password", async ({ page }) => {
  await signIn(page)
  await unlock(page)
  const p = await project(page, "r2-egress")
  db("update settings set secret_allow_private = false")
  try {
    for (const url of ["http://127.0.0.1:9/x", "http://localhost:9/x", "http://[::ffff:7f00:1]:9/x", "http://169.254.169.254/latest/meta-data/", "http://u:p@example.com/x"]) {
      const r = await page.request.post(`${API}/projects/${p.id}/envs/${p.dev}/webhooks`, { data: { url } })
      expect([400, 422], `${url}: ${await r.text()}`).toContain(r.status())
    }
    // With the admin switch on, an internal receiver is fine.
    db("update settings set secret_allow_private = true")
    expect((await page.request.post(`${API}/projects/${p.id}/envs/${p.dev}/webhooks`, { data: { url: "http://127.0.0.1:9/x" } })).status()).toBe(200)

    // Nimbus's own Redis, however it's spelled, is refused before any command runs.
    for (const host of ["127.0.0.1", "localhost", "0.0.0.0"]) {
      const c = await (await page.request.post(`${API}/projects/${p.id}/dynamic`, { data: { name: `own-${host}`, engine: "redis", host, port: OWN_REDIS, createSql: "FLUSHALL\nACL SETUSER {{username}} on >{{password}} ~* +@all", revokeSql: "ACL DELUSER {{username}}" } })).json()
      const t = await (await page.request.post(`${API}/projects/${p.id}/dynamic/${c.id}`, { data: { action: "test" } })).json()
      expect(t, host).toMatchObject({ ok: false })
      expect(t.message).toContain("own database or Redis")
      const g = await page.request.post(`${API}/projects/${p.id}/dynamic/${c.id}`, { data: { action: "generate" } })
      expect(g.status()).toBe(502)
    }

    // The stored admin password only goes to the host it was typed for.
    const c = await (await page.request.post(`${API}/projects/${p.id}/dynamic`, { data: { name: "elsewhere", engine: "postgres", host: "127.0.0.1", port: 5999, adminUser: "postgres", adminPassword: "first" } })).json()
    const moved = await page.request.patch(`${API}/projects/${p.id}/dynamic/${c.id}`, { data: { host: "203.0.113.9" } })
    expect(moved.status()).toBe(422)
    expect((await moved.json()).fields.adminPassword).toBeTruthy()
    expect((await page.request.patch(`${API}/projects/${p.id}/dynamic/${c.id}`, { data: { host: "127.0.0.1", name: "renamed" } })).status()).toBe(200)
    expect((await page.request.patch(`${API}/projects/${p.id}/dynamic/${c.id}`, { data: { host: "203.0.113.9", adminPassword: "again" } })).status()).toBe(200)
  } finally {
    db("update settings set secret_allow_private = false")
    await page.request.delete(`${API}/projects/${p.id}`)
  }
})

test("jump host: the terminal and server push reach a host with no port of its own, and the exported config's ProxyJump works", async ({ page }) => {
  test.setTimeout(180_000)
  const work = mkdtempSync(join(tmpdir(), "r2-"))
  // The jump host must allow forwarding (OpenSSH's default; this image turns it off).
  dx("r2-jump", "sed -i 's/^AllowTcpForwarding no/AllowTcpForwarding yes/' /config/sshd/sshd_config && kill -HUP $(cat /config/sshd.pid)")
  const kf = join(work, "nimbus_r2-key")
  sh("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "r2", "-f", kf])
  const pub = readFileSync(kf + ".pub", "utf8").trim()
  for (const c of ["r2-jump", "r2-inner"]) dx(c, `printf '%s\\n' '${pub}' > /config/.ssh/authorized_keys && chown tester:users /config/.ssh/authorized_keys && chmod 600 /config/.ssh/authorized_keys`)
  dx("r2-inner", "rm -f /config/pushed.env")

  await signIn(page)
  await unlock(page)
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })
  const p = await project(page, "r2-jump")
  await page.request.post(`${API}/projects/${p.id}/secrets`, { data: { envId: p.dev, ops: [{ key: "VIA_JUMP", value: "through-the-bastion" }] } })
  try {
    const key = await (await page.request.post(`${API}/projects/${p.id}/ssh/keys`, { data: { mode: "import", name: "r2 key", privateKey: readFileSync(kf, "utf8") } })).json()
    const jump = await (await page.request.post(`${API}/projects/${p.id}/ssh/hosts`, { data: { name: "bastion", host: "127.0.0.1", port: JUMP_PORT, username: "tester", keyId: key.id } })).json()
    // r2-inner only resolves inside the Docker network, so only the jump host can reach it.
    const inner = await (await page.request.post(`${API}/projects/${p.id}/ssh/hosts`, { data: { name: "inner", host: "r2-inner", port: 2222, username: "tester", keyId: key.id, jumpHostId: jump.id } })).json()
    expect(inner.id).toBeTruthy()
    // One hop only, from either side: the bastion can't get a jump host of its own now.
    const chain = await page.request.put(`${API}/projects/${p.id}/ssh/hosts/${jump.id}`, { data: { name: "bastion", host: "127.0.0.1", port: JUMP_PORT, username: "tester", keyId: key.id, jumpHostId: inner.id } })
    expect(chain.status()).toBe(400)

    // ---- terminal through the jump host ----
    await page.goto(`/secrets/${p.id}?view=ssh`)
    await page.getByRole("tab", { name: "Hosts" }).click()
    const row = page.getByTestId("ssh-hosts").locator("li").filter({ hasText: "r2-inner" })
    await expect(row).toContainText("via bastion")
    await row.getByRole("button", { name: "Terminal" }).click()
    await expect(page.getByTestId("term-status")).toHaveText("Connected", { timeout: 30_000 })
    await page.getByTestId("term-box").click()
    await page.keyboard.type("echo inner-$((6*7)) $(hostname)")
    await page.keyboard.press("Enter")
    const innerName = dx("r2-inner", "hostname").trim()
    await expect(page.getByTestId("term-box")).toContainText(`inner-42 ${innerName}`)
    await page.keyboard.type("exit")
    await page.keyboard.press("Enter")
    await expect(page.getByTestId("term-status")).toHaveText("Session ended.", { timeout: 15_000 })
    await page.getByRole("button", { name: "Close", exact: true }).click()
    // Both host keys were pinned on first use.
    const hosts = (await (await page.request.get(`${API}/projects/${p.id}/ssh/hosts`)).json()).hosts as { name: string; pinned: boolean }[]
    expect(hosts.map((h) => [h.name, h.pinned]).sort()).toEqual([["bastion", true], ["inner", true]])
    expect(db(`select count(*) from audit_events where action='secrets_ssh_session_start' and project_id='${p.id}' and detail like '%r2-inner%'`)).toBe("1")

    // ---- ~/.ssh/config export: ProxyJump works from a shell ----
    const cfg = await (await page.request.get(`${API}/projects/${p.id}/ssh/config?host=${inner.id}`)).text()
    expect(cfg).toContain("ProxyJump bastion")
    const conf = join(work, "config")
    writeFileSync(conf, "Host *\n  StrictHostKeyChecking no\n  UserKnownHostsFile /dev/null\n  BatchMode yes\n  LogLevel ERROR\n\n" + cfg.replaceAll("~/.ssh/", `${work}/`))
    chmodSync(kf, 0o600)
    expect(sh("ssh", ["-F", conf, "inner", "echo via-proxyjump $(hostname)"]).trim()).toBe(`via-proxyjump ${innerName}`)

    // ---- server push to the same host:port goes through the entry's jump host ----
    const P = `${API}/projects/${p.id}/envs/${p.dev}/push`
    expect((await page.request.put(P, { data: { host: "r2-inner", port: 2222, username: "tester", path: "/config/pushed.env", keyId: key.id, postCommand: "echo done >> /config/ran" } })).status()).toBe(200)
    expect((await (await page.request.get(P)).json()).push.via).toBe("bastion")
    const run = await page.request.post(P)
    expect(run.status(), await run.text()).toBe(200)
    expect((await run.json()).message).toBe("Wrote /config/pushed.env, ran the command")
    expect(dx("r2-inner", "cat /config/pushed.env")).toContain("through-the-bastion")
    expect(dx("r2-inner", "stat -c %a /config/pushed.env").trim()).toBe("600")
    // The push pinned the inner host's key; a changed jump host key stops it.
    expect(db(`select host_key is not null from secret_push_targets where env_id='${p.dev}'`)).toBe("t")
    db(`update secret_ssh_hosts set host_key='AAAAwrong' where id='${jump.id}'`)
    const bad = await page.request.post(P)
    expect(bad.status()).toBe(502)
    expect((await bad.json()).message).toContain("jump host bastion's host key changed")

    // Without the jump host entry, Nimbus can't resolve the inner name itself.
    await page.request.delete(`${API}/projects/${p.id}/ssh/hosts/${inner.id}`)
    expect((await (await page.request.get(P)).json()).push.via).toBeNull()
    const direct = await page.request.post(P)
    expect(direct.status()).toBe(502)
    expect((await direct.json()).message).toContain("doesn't resolve")
  } finally {
    await page.request.delete(`${API}/projects/${p.id}`)
  }
})

const TLS = process.env.E2E_REDIS_TLS_DIR
test("Redis over TLS through the app: the CA field, a lease that logs in, revoke", async ({ page }) => {
  test.skip(!TLS, "set E2E_REDIS_TLS_DIR (see the header)")
  const ca = readFileSync(`${TLS}/ca.pem`, "utf8")
  await signIn(page)
  await unlock(page)
  const p = await project(page, "r2-redis-tls")
  try {
    const conn = await (await page.request.post(`${API}/projects/${p.id}/dynamic`, { data: { name: "redis-tls", engine: "redis", host: "127.0.0.1", port: 63420, tls: true, adminPassword: "adminpw" } })).json()
    const base = `${API}/projects/${p.id}/dynamic`
    const untrusted = await (await page.request.post(`${base}/${conn.id}`, { data: { action: "test" } })).json()
    expect(untrusted.ok).toBe(false)
    expect(untrusted.message).toContain("isn't trusted")
    expect((await page.request.patch(`${base}/${conn.id}`, { data: { ca } })).status()).toBe(200)
    const ok = await (await page.request.post(`${base}/${conn.id}`, { data: { action: "test" } })).json()
    expect(ok, ok.message).toMatchObject({ ok: true })
    expect(ok.message).toMatch(/Redis \d/)

    const g = await (await page.request.post(`${base}/${conn.id}`, { data: { action: "generate", ttl: "10m" } })).json()
    expect(g.url).toMatch(/^rediss:\/\//)
    const login = (pw: string) => {
      const r = new Redis({ host: "127.0.0.1", port: 63420, username: g.username, password: pw, tls: { ca }, lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null })
      r.on("error", () => {})
      return r.connect().then(() => r.get("r2-probe")).finally(() => r.disconnect())
    }
    expect(await login(g.password)).toBeNull()
    expect((await page.request.delete(`${base}/leases/${g.lease.id}`)).status()).toBe(200)
    await expect(login(g.password)).rejects.toThrow()
  } finally {
    await page.request.delete(`${API}/projects/${p.id}`)
  }
})
