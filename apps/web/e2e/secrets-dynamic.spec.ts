import { expect, test, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"

import { Redis } from "ioredis"

import { execute, ping, type Target } from "../lib/secrets/dyn-drivers"
import { DEFAULT_TEMPLATE, newPassword, render, type Engine } from "../lib/secrets/dyn-rules"
import { OTHER, PASSWORD, signIn, unique } from "./helpers"

// S6a: dynamic database credentials and rotation, against throwaway Docker databases:
//   s6a-pg 54410, s6a-mysql 33410, s6a-redis 63410, s6a-mongo 27410 (admin password "adminpw").
// The worker isn't running here: the delayed expiry job is checked in Redis and then
// run through /api/jobs, the way the worker would forward it.
const API = "/api/v1/secrets"
const REDIS = process.env.E2E_REDIS_URL ?? "redis://localhost:6380/0"
const db = (q: string) => execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()

const ADMIN: Record<Engine, { port: number; user: string; database: string }> = {
  postgres: { port: 54410, user: "postgres", database: "postgres" },
  mysql: { port: 33410, user: "root", database: "app" },
  redis: { port: 63410, user: "", database: "" },
  mongodb: { port: 27410, user: "root", database: "admin" },
}
const admin = (e: Engine): Target => ({ engine: e, host: "127.0.0.1", port: ADMIN[e].port, database: ADMIN[e].database, tls: false, username: ADMIN[e].user, password: "adminpw" })
const works = (e: Engine, username: string, password: string) => ping({ ...admin(e), username, password }).then(() => true, () => false)
const exp = () => new Date(Date.now() + 3600_000).toISOString().replace(/\.\d+Z$/, "Z")

async function unlock(page: Page) {
  await page.goto("/secrets")
  await page.getByLabel("Your Nimbus password").fill(PASSWORD)
  await page.getByRole("button", { name: "Unlock", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible()
}

function jobToken() {
  return execFileSync("node", ["--env-file=.env.local", "--input-type=module", "-e", "import {signToken} from './lib/upload-rules.ts'; console.log(signToken('job',{},60000))"]).toString().trim()
}
async function job(page: Page, name: string, data: object = {}) {
  const r = await page.request.post("/api/jobs", { headers: { authorization: `Bearer ${jobToken()}` }, data: { name, data } })
  expect(r.status()).toBe(204)
}

async function seed(page: Page) {
  const made = await (await page.request.post(`${API}/projects`, { data: { name: unique("dyn") } })).json()
  const detail = await (await page.request.get(`${API}/projects/${made.id}`)).json()
  const envs = Object.fromEntries(detail.envs.map((e: { slug: string; id: string }) => [e.slug, e.id]))
  return { id: made.id as string, envs, slug: detail.slug as string }
}

type Conn = { id: string; name: string }
async function addConn(page: Page, pid: string, engine: Engine, extra: Record<string, unknown> = {}) {
  const a = ADMIN[engine]
  const r = await page.request.post(`${API}/projects/${pid}/dynamic`, {
    data: { name: `${engine}-conn`, engine, host: "127.0.0.1", port: a.port, database: a.database, adminUser: a.user, adminPassword: "adminpw", defaultTtl: "1h", maxTtl: "2h", ...extra },
  })
  expect(r.status(), await r.text()).toBe(200)
  return (await r.json()) as Conn
}

// Leftover delayed expiry jobs are removed so nothing fires later.
async function dropJobs(redis: Redis, leaseId: string) {
  for (const k of await redis.keys(`bull:jobs:lease-${leaseId}-*`)) {
    await redis.zrem("bull:jobs:delayed", k.replace("bull:jobs:", ""))
    await redis.del(k)
  }
}

const valueOf = async (page: Page, pid: string, env: string, key: string) =>
  ((await (await page.request.get(`${API}/projects/${pid}/secrets?env=${env}&values=true`)).json()).secrets as { key: string; value: string }[]).find((s) => s.key === key)?.value
const secretId = async (page: Page, pid: string, env: string, key: string) =>
  ((await (await page.request.get(`${API}/projects/${pid}/secrets?env=${env}`)).json()).secrets as { id: string; key: string }[]).find((s) => s.key === key)!.id

for (const engine of ["postgres", "mysql", "redis", "mongodb"] as const) {
  test(`${engine}: a lease user logs in, then can't after revoke or expiry`, async ({ page }) => {
    test.setTimeout(90_000)
    const redis = new Redis(REDIS)
    await page.waitForTimeout(10_500)
    await signIn(page)
    await unlock(page)
    const p = await seed(page)
    const base = `${API}/projects/${p.id}/dynamic`
    const conn = await addConn(page, p.id, engine)

    // The Test button's endpoint.
    const t = await (await page.request.post(`${base}/${conn.id}`, { data: { action: "test" } })).json()
    expect(t.ok, t.message).toBe(true)

    // Generate: a fresh user whose password works; one delayed expiry job is queued.
    const g = await (await page.request.post(`${base}/${conn.id}`, { data: { action: "generate", ttl: "10m" } })).json()
    expect(g.username).toMatch(/^nim_[0-9a-f]{12}$/)
    expect(g.ttl).toBe(600)
    expect(await works(engine, g.username, g.password)).toBe(true)
    expect(await works(engine, g.username, `${g.password}x`)).toBe(false)
    expect((await redis.zrange("bull:jobs:delayed", "0", "-1")).some((id) => id.startsWith(`lease-${g.lease.id}-`))).toBe(true)

    // Reveal (audited) and renew.
    const shown = await (await page.request.get(`${base}/leases/${g.lease.id}`)).json()
    expect(shown.password).toBe(g.password)
    const renewed = await (await page.request.patch(`${base}/leases/${g.lease.id}`, { data: { ttl: "30m" } })).json()
    expect(new Date(renewed.expiresAt).getTime()).toBeGreaterThan(new Date(g.lease.expiresAt).getTime() + 10 * 60_000)
    // Past issue + max TTL (2h) it refuses.
    expect((await page.request.patch(`${base}/leases/${g.lease.id}`, { data: { ttl: "5d" } })).status()).toBe(200)
    expect((await page.request.patch(`${base}/leases/${g.lease.id}`, { data: { ttl: "5d" } })).status()).toBe(409)

    // Manual revoke.
    expect((await page.request.delete(`${base}/leases/${g.lease.id}`)).status()).toBe(200)
    expect(await works(engine, g.username, g.password)).toBe(false)
    expect((await page.request.get(`${base}/leases/${g.lease.id}`)).status()).toBe(410)
    await dropJobs(redis, g.lease.id)

    // Expiry through the delayed job (run the way the worker forwards it).
    const e1 = await (await page.request.post(`${base}/${conn.id}`, { data: { action: "generate", ttl: "10m" } })).json()
    expect(await works(engine, e1.username, e1.password)).toBe(true)
    db(`update secret_db_leases set expires_at = now() - interval '5 seconds' where id = '${e1.lease.id}'`)
    await job(page, "secrets-lease-expire", { id: e1.lease.id })
    expect(await works(engine, e1.username, e1.password)).toBe(false)

    // Expiry through the hourly sweep, when the job went missing.
    const e2 = await (await page.request.post(`${base}/${conn.id}`, { data: { action: "generate", ttl: "10m" } })).json()
    await dropJobs(redis, e2.lease.id)
    db(`update secret_db_leases set expires_at = now() - interval '5 seconds' where id = '${e2.lease.id}'`)
    await job(page, "secrets-sweep")
    expect(await works(engine, e2.username, e2.password)).toBe(false)
    await dropJobs(redis, e1.lease.id)

    const list = await (await page.request.get(base)).json()
    expect(list.leases.map((l: { state: string }) => l.state)).toEqual(["revoked", "revoked", "revoked"])
    expect(list.connections[0]).not.toHaveProperty("adminPassword")
    // The sealed admin login never leaves the server.
    expect(JSON.stringify(list)).not.toContain("adminpw")

    // Everything is in the project's audit log, and none of it holds a password.
    const audit = await (await page.request.get(`${API}/projects/${p.id}/audit`)).json()
    const actions = new Set(audit.rows.map((r: { action: string }) => r.action))
    for (const a of ["secrets_dyn_conn_save", "secrets_dyn_conn_test", "secrets_dyn_lease", "secrets_dyn_reveal", "secrets_dyn_renew", "secrets_dyn_revoke"]) expect(actions.has(a), a).toBe(true)
    expect(JSON.stringify(audit)).not.toContain(g.password)

    expect((await page.request.delete(`${API}/projects/${p.id}`)).status()).toBe(200)
    await redis.quit()
  })
}

for (const engine of ["postgres", "mysql", "redis", "mongodb"] as const) {
  test(`${engine}: rotation changes the password, old fails, new works, history has the new version`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.waitForTimeout(10_500)
    await signIn(page)
    await unlock(page)
    const p = await seed(page)
    const base = `${API}/projects/${p.id}/dynamic`
    const conn = await addConn(page, p.id, engine)

    // A user that already exists, and a secret holding its password in a protected environment.
    const user = `app_${engine}_${Date.now().toString(36)}`
    const old = newPassword()
    await execute(admin(engine), render(DEFAULT_TEMPLATE[engine].create, { username: user, password: old, expiry: exp() }))
    const dev = p.envs.development
    await page.request.post(`${API}/projects/${p.id}/secrets`, { data: { envId: dev, ops: [{ key: "DB_PASSWORD", value: old }] } })
    expect((await page.request.patch(`${API}/projects/${p.id}/envs/${dev}`, { data: { policy: { protected: true, approvalsRequired: 1, approverIds: null, adminBypass: false } } })).status()).toBe(200)
    const sid = await secretId(page, p.id, "development", "DB_PASSWORD")

    // Validation: a user that isn't on the database is refused.
    const nope = await page.request.post(`${base}/rotations`, { data: { secretId: sid, connectionId: conn.id, username: "ghost_user_x", mode: "single", intervalDays: 7 } })
    expect(nope.status()).toBe(422)
    const made = await page.request.post(`${base}/rotations`, { data: { secretId: sid, connectionId: conn.id, username: user, mode: "single", intervalDays: 7 } })
    expect(made.status(), await made.text()).toBe(200)
    const rid = (await made.json()).id as string
    expect((await page.request.post(`${base}/rotations`, { data: { secretId: sid, connectionId: conn.id, username: user, mode: "single" } })).status()).toBe(409)

    expect(await works(engine, user, old)).toBe(true)
    const r = await page.request.post(`${base}/rotations/${rid}`)
    expect(r.status(), await r.text()).toBe(200)
    const next = (await valueOf(page, p.id, "development", "DB_PASSWORD"))!
    expect(next).not.toBe(old)
    expect(await works(engine, user, old)).toBe(false)
    expect(await works(engine, user, next)).toBe(true)

    // History: a new version with the action "rotate".
    const hist = await (await page.request.get(`${API}/projects/${p.id}/history?secretId=${sid}`)).json()
    expect(JSON.stringify(hist)).toContain('"rotate"')
    expect(db(`select count(*) from secret_versions where secret_id = '${sid}'`)).toBe("2")

    // A failure keeps the old value: the user is dropped on the database, then rotated.
    await execute(admin(engine), render(DEFAULT_TEMPLATE[engine].revoke, { username: user }))
    const bad = await page.request.post(`${base}/rotations/${rid}`)
    expect(bad.status()).toBe(502)
    expect(await valueOf(page, p.id, "development", "DB_PASSWORD")).toBe(next)
    const rots = (await (await page.request.get(base)).json()).rotations as { error: string | null }[]
    expect(rots[0].error).toContain(user)
    expect(Number(db(`select count(*) from notifications where data->>'text' like '%Couldn''t rotate the password of ${user}%'`))).toBeGreaterThan(0)

    // Audit: the rotation, its failure; no password.
    const audit = JSON.stringify(await (await page.request.get(`${API}/projects/${p.id}/audit`)).json())
    expect(audit).toContain("secrets_dyn_rotate")
    expect(audit).not.toContain(next)
    expect(audit).not.toContain(old)

    expect((await page.request.delete(`${API}/projects/${p.id}`)).status()).toBe(200)
  })
}

test("rotation in a protected environment skips the change request; two-user alternation keeps the other password working", async ({ page }) => {
  test.setTimeout(90_000)
  await page.waitForTimeout(10_500)
  await signIn(page)
  await unlock(page)
  const p = await seed(page)
  const base = `${API}/projects/${p.id}/dynamic`
  const dev = p.envs.development

  for (const engine of ["postgres", "mysql"] as const) {
    const conn = await addConn(page, p.id, engine)
    const a = `blue_${engine}_${Date.now().toString(36)}`
    const b = `green_${engine}_${Date.now().toString(36)}`
    const pwA = newPassword()
    const pwB = newPassword()
    for (const [u, pw] of [[a, pwA], [b, pwB]] as const) await execute(admin(engine), render(DEFAULT_TEMPLATE[engine].create, { username: u, password: pw, expiry: exp() }))
    const key = `PASS_${engine.toUpperCase()}`
    await page.request.post(`${API}/projects/${p.id}/secrets`, { data: { envId: dev, ops: [{ key, value: pwA }, { key: `USER_${engine.toUpperCase()}`, value: a }] } })
    // Production-like: the environment is protected from now on.
    await page.request.patch(`${API}/projects/${p.id}/envs/${dev}`, { data: { policy: { protected: true, approvalsRequired: 1, approverIds: null, adminBypass: false } } })
    const sid = await secretId(page, p.id, "development", key)
    const made = await page.request.post(`${base}/rotations`, { data: { secretId: sid, connectionId: conn.id, username: a, usernameB: b, usernameKey: `USER_${engine.toUpperCase()}`, mode: "alternate", intervalDays: 1 } })
    expect(made.status(), await made.text()).toBe(200)
    const rid = (await made.json()).id as string

    expect((await page.request.post(`${base}/rotations/${rid}`)).status()).toBe(200)
    // The secret holds the other user and its new password; nothing waits for approval.
    const user1 = (await valueOf(page, p.id, "development", `USER_${engine.toUpperCase()}`))!
    const pw1 = (await valueOf(page, p.id, "development", key))!
    expect(user1).toBe(b)
    expect(await works(engine, b, pw1)).toBe(true)
    expect(await works(engine, b, pwB)).toBe(false)
    // The previous user keeps working with its old password, so an app mid-rollout isn't cut off.
    expect(await works(engine, a, pwA)).toBe(true)
    expect((await (await page.request.get(`${API}/projects/${p.id}/requests`)).json()).requests ?? []).toHaveLength(0)

    // Next rotation moves back to the first user.
    expect((await page.request.post(`${base}/rotations/${rid}`)).status()).toBe(200)
    expect(await valueOf(page, p.id, "development", `USER_${engine.toUpperCase()}`)).toBe(a)
    const pw2 = (await valueOf(page, p.id, "development", key))!
    expect(await works(engine, a, pw2)).toBe(true)
    expect(await works(engine, a, pwA)).toBe(false)
    expect(await works(engine, b, pw1)).toBe(true)

    // Due rotations run in the hourly sweep.
    db(`update secret_rotations set next_at = now() - interval '1 minute' where id = '${rid}'`)
    await job(page, "secrets-sweep")
    expect(await valueOf(page, p.id, "development", `USER_${engine.toUpperCase()}`)).toBe(b)
    expect(await works(engine, b, pw1)).toBe(false)
    await page.request.patch(`${API}/projects/${p.id}/envs/${dev}`, { data: { policy: { protected: false, approvalsRequired: 1, approverIds: null, adminBypass: false } } })
  }
  // Redis can't alternate.
  const rc = await addConn(page, p.id, "redis")
  await page.request.post(`${API}/projects/${p.id}/secrets`, { data: { envId: dev, ops: [{ key: "PLAIN_ONE", value: "x" }] } })
  const sid = await secretId(page, p.id, "development", "PLAIN_ONE")
  const no = await page.request.post(`${base}/rotations`, { data: { secretId: sid, connectionId: rc.id, username: "default", usernameB: "x", usernameKey: "U", mode: "alternate" } })
  expect(no.status()).toBe(422)

  expect((await page.request.delete(`${API}/projects/${p.id}`)).status()).toBe(200)
})

async function tokenFor(page: Page, pid: string, envId: string, access: "ro" | "rw") {
  const r = await page.request.post(`${API}/projects/${pid}/tokens`, { data: { name: `dyn-${access}`, envIds: [envId], access } })
  expect(r.status()).toBe(200)
  return (await r.json()).token as string
}

test("viewers can't generate, renew, revoke or rotate; machine tokens and the CLI API", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000)
  await page.waitForTimeout(10_500)
  await signIn(page)
  await unlock(page)
  const p = await seed(page)
  const base = `${API}/projects/${p.id}/dynamic`
  const conn = await addConn(page, p.id, "postgres")
  const g = await (await page.request.post(`${base}/${conn.id}`, { data: { action: "generate" } })).json()

  expect((await page.request.post(`${API}/projects/${p.id}/members`, { data: { email: OTHER, role: "viewer", envIds: null } })).status()).toBe(200)
  const ctx = await browser.newContext({ baseURL })
  const v = await ctx.newPage()
  await v.waitForTimeout(10_500)
  await signIn(v, OTHER)
  await unlock(v)
  const list = await (await v.request.get(base)).json()
  expect(list.connections).toHaveLength(1)
  expect(list.connections[0].createSql).toBeTruthy()
  expect(list.connections[0].adminUser).toBe("")
  expect(list.leases).toEqual([])
  expect(list.rotations).toEqual([])
  expect((await v.request.post(`${base}/${conn.id}`, { data: { action: "generate" } })).status()).toBe(403)
  expect((await v.request.post(`${base}/${conn.id}`, { data: { action: "test" } })).status()).toBe(403)
  expect((await v.request.get(`${base}/leases/${g.lease.id}`)).status()).toBe(403)
  expect((await v.request.patch(`${base}/leases/${g.lease.id}`, { data: { ttl: "1h" } })).status()).toBe(403)
  expect((await v.request.delete(`${base}/leases/${g.lease.id}`)).status()).toBe(403)
  expect((await v.request.post(`${base}/rotations`, { data: {} })).status()).toBe(403)
  expect((await v.request.post(base, { data: { name: "x", engine: "postgres", host: "h" } })).status()).toBe(403)
  await v.goto(`/secrets/${p.id}?view=dynamic`)
  await expect(v.getByRole("heading", { name: "Dynamic secrets" })).toBeVisible()
  await expect(v.getByRole("button", { name: "Generate" })).toHaveCount(0)
  await expect(v.getByRole("button", { name: "Add connection" })).toHaveCount(0)
  await expect(v.getByRole("tab", { name: "Leases" })).toHaveCount(0)
  await ctx.close()

  // Machine tokens: read-write issues, read-only is refused; secrets are unaffected.
  const rw = await tokenFor(page, p.id, p.envs.development, "rw")
  const ro = await tokenFor(page, p.id, p.envs.development, "ro")
  const bearer = { headers: { authorization: `Bearer ${rw}` } }
  const issued = await page.request.post(`${API}/dynamic`, { ...bearer, data: { connection: "postgres-conn", ttl: "15m" } })
  expect(issued.status(), await issued.text()).toBe(200)
  const lease = await issued.json()
  expect(lease.ttl).toBe(900)
  expect(lease.url).toContain(lease.username)
  expect(await works("postgres", lease.username, lease.password)).toBe(true)
  expect((await page.request.post(`${API}/dynamic`, { headers: { authorization: `Bearer ${ro}` }, data: { connection: "postgres-conn" } })).status()).toBe(403)
  expect((await page.request.post(`${API}/dynamic`, { ...bearer, data: { connection: "nope" } })).status()).toBe(404)
  const listed = await (await page.request.get(`${API}/dynamic`, bearer)).json()
  expect(listed.connections[0]).toEqual(expect.objectContaining({ name: "postgres-conn", engine: "postgres", defaultTtl: 3600, maxTtl: 7200 }))
  expect((await page.request.patch(`${API}/dynamic`, { ...bearer, data: { lease: lease.leaseId, ttl: "30m" } })).status()).toBe(200)
  expect((await page.request.delete(`${API}/dynamic?lease=${lease.leaseId}`, bearer)).status()).toBe(200)
  expect(await works("postgres", lease.username, lease.password)).toBe(false)
  // Audit names the token, not a person.
  const audit = JSON.stringify(await (await page.request.get(`${API}/projects/${p.id}/audit`)).json())
  expect(audit).toContain("token: dyn-rw")

  const redis = new Redis(REDIS)
  await dropJobs(redis, g.lease.id)
  await dropJobs(redis, lease.leaseId)
  await redis.quit()
  expect((await page.request.delete(`${API}/projects/${p.id}`)).status()).toBe(200)
})

test("screens: add a connection, generate, reveal, rotate (1440 and 390)", async ({ page }) => {
  test.setTimeout(150_000)
  await page.waitForTimeout(10_500)
  await signIn(page)
  await unlock(page)
  const p = await seed(page)
  const shots = process.env.E2E_SHOTS
  const shot = async (name: string) => shots && (await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }))
  const redis = new Redis(REDIS)

  await page.goto(`/secrets/${p.id}?view=dynamic`)
  await expect(page.getByRole("heading", { name: "Dynamic secrets" })).toBeVisible()
  await expect(page.getByText("No database connections")).toBeVisible()
  await shot("dyn-empty-1440")

  await page.getByRole("button", { name: "Add connection" }).click()
  const dlg = page.getByRole("dialog")
  await dlg.getByLabel("Name", { exact: true }).fill("orders-db")
  await dlg.getByLabel("Host").fill("127.0.0.1")
  await dlg.getByLabel("Port").fill("54410")
  await dlg.getByLabel("Database", { exact: true }).fill("postgres")
  await dlg.getByLabel("Admin user").fill("postgres")
  await dlg.getByLabel("Admin password").fill("adminpw")
  await dlg.getByLabel("Longest lease").fill("nonsense")
  await dlg.getByRole("button", { name: "Add connection" }).click()
  await expect(dlg.getByText("Use a time like 30m, 2h or 7d")).toBeVisible()
  await shot("dyn-conn-dialog-1440")
  await dlg.getByLabel("Longest lease").fill("2h")
  // A template with an unknown placeholder is refused with a reason.
  await dlg.getByLabel(/Creation/).fill(`CREATE ROLE "{{user}}" LOGIN PASSWORD '{{password}}'`)
  await dlg.getByRole("button", { name: "Add connection" }).click()
  await expect(dlg.getByText(/isn't a placeholder/)).toBeVisible()
  await dlg.getByLabel(/Creation/).fill(`CREATE ROLE "{{username}}" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiry}}';\nGRANT pg_read_all_data TO "{{username}}";`)
  await dlg.getByRole("button", { name: "Add connection" }).click()
  await expect(dlg).toHaveCount(0)
  await expect(page.getByText("orders-db")).toBeVisible()
  await shot("dyn-connections-1440")

  await page.getByRole("button", { name: "Test", exact: true }).click()
  await expect(page.getByText(/Connected\. PostgreSQL/)).toBeVisible()

  await page.getByRole("button", { name: "Generate", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Generate", exact: true }).click()
  const ready = page.getByRole("dialog")
  await expect(ready.getByText("Credentials ready")).toBeVisible()
  await shot("dyn-issued-1440")
  // The password is hidden until shown, and the user can log in.
  await expect(ready.locator("code").filter({ hasText: /^•+$/ })).toHaveCount(2)
  const username = (await ready.locator("code").nth(2).textContent())!.trim()
  await ready.getByRole("button", { name: "Show", exact: true }).first().click()
  const password = (await ready.locator("code").nth(3).textContent())!.trim()
  expect(password).toMatch(/^[A-Za-z0-9]{32}$/)
  expect(await works("postgres", username, password)).toBe(true)
  await ready.getByRole("button", { name: "Done" }).click()

  await page.getByRole("tab", { name: "Leases" }).click()
  await expect(page.getByText(username)).toBeVisible()
  await expect(page.getByText("Active", { exact: true })).toBeVisible()
  await shot("dyn-leases-1440")
  await page.getByRole("button", { name: "Reveal" }).click()
  await expect(page.getByRole("dialog").getByText("Credentials", { exact: true })).toBeVisible()
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click()
  await page.getByRole("button", { name: "Renew" }).click()
  await page.getByRole("dialog").getByLabel("Extend to").fill("90m")
  await page.getByRole("dialog").getByRole("button", { name: "Renew" }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.getByRole("button", { name: "Revoke" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click()
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible()
  expect(await works("postgres", username, password)).toBe(false)

  // Rotation through the screen.
  const user = `ui_user_${Date.now().toString(36)}`
  const old = newPassword()
  await execute(admin("postgres"), render(DEFAULT_TEMPLATE.postgres.create, { username: user, password: old, expiry: exp() }))
  await page.request.post(`${API}/projects/${p.id}/secrets`, { data: { envId: p.envs.development, ops: [{ key: "ORDERS_DB_PASSWORD", value: old }] } })
  await page.getByRole("tab", { name: "Rotation" }).click()
  await expect(page.getByText("No rotations")).toBeVisible()
  await shot("dyn-rotations-empty-1440")
  await page.getByRole("button", { name: "Add rotation" }).click()
  const rd = page.getByRole("dialog")
  await rd.getByLabel("Secret", { exact: true }).fill("ORDERS_DB")
  await rd.getByRole("button", { name: /ORDERS_DB_PASSWORD/ }).click()
  await rd.getByLabel("Every (days)").fill("30")
  await rd.getByLabel(/Database user/).fill("ghost_nobody")
  await rd.getByRole("button", { name: "Add rotation" }).click()
  await expect(rd.getByText(/no user/i).first()).toBeVisible()
  await rd.getByLabel(/Database user/).fill(user)
  await rd.getByLabel("Method").selectOption("alternate")
  await shot("dyn-rotation-dialog-1440")
  await rd.getByLabel("Method").selectOption("single")
  await rd.getByRole("button", { name: "Add rotation" }).click()
  await expect(page.getByText("ORDERS_DB_PASSWORD")).toBeVisible()
  await shot("dyn-rotations-1440")
  await page.getByRole("button", { name: "Rotate now" }).click()
  await expect(page.getByText(/Rotated ORDERS_DB_PASSWORD/)).toBeVisible()
  expect(await works("postgres", user, old)).toBe(false)
  expect(await works("postgres", user, (await valueOf(page, p.id, "development", "ORDERS_DB_PASSWORD"))!)).toBe(true)

  // Phone width.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/secrets/${p.id}?view=dynamic`)
  await expect(page.getByText("orders-db")).toBeVisible()
  await shot("dyn-connections-390")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole("tab", { name: "Rotation" }).click()
  await shot("dyn-rotations-390")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole("tab", { name: "Connections" }).click()
  await page.getByRole("button", { name: "Add connection" }).click()
  await shot("dyn-conn-dialog-390")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Generate", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Generate", exact: true }).click()
  await expect(page.getByText("Credentials ready")).toBeVisible()
  await shot("dyn-issued-390")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  for (const k of await redis.keys("bull:jobs:lease-*")) {
    await redis.zrem("bull:jobs:delayed", k.replace("bull:jobs:", ""))
    await redis.del(k)
  }
  await redis.quit()
  await page.keyboard.press("Escape")
  // Revoking what the screen made, then removing the project.
  const leases = (await (await page.request.get(`${API}/projects/${p.id}/dynamic`)).json()).leases as { id: string; state: string }[]
  for (const l of leases.filter((l) => l.state === "active")) await page.request.delete(`${API}/projects/${p.id}/dynamic/leases/${l.id}`)
  expect((await page.request.delete(`${API}/projects/${p.id}`)).status()).toBe(200)
})
