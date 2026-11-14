import { expect, request as pwRequest, test, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"

import { OTHER, PASSWORD, signIn, unique } from "./helpers"

// Review R1 (auth and access control) regressions. Needs SECRETS_ROOT_KEY and Secrets on.
const API = "/api/v1/secrets"
const db = (q: string) =>
  execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()

async function unlock(page: Page) {
  await page.goto("/secrets")
  await page.getByLabel("Your Nimbus password").fill(PASSWORD)
  await page.getByRole("button", { name: "Unlock", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible()
}

test("grants, rollback, merges, unlock tries, token folder scope and CLI idle cap", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000)
  await signIn(page)
  await unlock(page)
  const { id } = await (await page.request.post(`${API}/projects`, { data: { name: unique("r1") } })).json()
  const P = `${API}/projects/${id}`
  const detail = await (await page.request.get(P)).json()
  const env = Object.fromEntries((detail.envs as { id: string; slug: string }[]).map((e) => [e.slug, e.id]))
  const dev = env.development
  const prod = env.production
  const ctx = await browser.newContext({ baseURL })
  const other = await ctx.newPage()
  try {
    expect((await page.request.post(`${P}/members`, { data: { email: OTHER, role: "viewer", envIds: [dev] } })).status()).toBe(200)
    const otherId = ((await (await page.request.get(`${P}/members`)).json()).members as { userId: string; email: string }[]).find((m) => m.email === OTHER)!.userId
    await other.waitForTimeout(10_500) // sign-in allows 3 tries per 10 seconds
    await signIn(other, OTHER)
    await unlock(other)

    // 1. A temporary developer grant on one environment opens secret writes there, not
    // project-wide Developer routes like items.
    expect((await other.request.post(`${P}/access-requests`, { data: { action: "create", envId: dev, role: "developer", minutes: 60, reason: "r1 test" } })).status()).toBe(200)
    const reqs = (await (await page.request.get(`${P}/access-requests`)).json()).requests as { id: string; status: string }[]
    expect((await page.request.post(`${P}/access-requests`, { data: { action: "approve", id: reqs.find((r) => r.status === "pending")!.id } })).status()).toBe(200)
    expect((await other.request.post(`${P}/secrets`, { data: { envId: dev, ops: [{ key: "GRANTED", value: "1" }] } })).status()).toBe(200)
    expect((await other.request.post(`${P}/items`, { data: { kind: "note", name: "nope", data: { body: "x" } } })).status()).toBe(403)
    expect((await other.request.post(`${P}/secrets/import`, { data: { mode: "apply", envId: dev, items: [], entries: [{ kind: "note", name: "nope", data: { body: "x" } }] } })).status()).toBe(403)
    db(`update secret_access_requests set expires_at = now() - interval '1 minute' where project_id = '${id}'`)

    // 2. A viewer can't turn a rollback of a protected environment into a change request.
    const before = new Date(Date.now() - 2000).toISOString()
    await page.waitForTimeout(2500)
    expect((await page.request.post(`${P}/secrets`, { data: { envId: prod, ops: [{ key: "API_KEY", value: "v1" }] } })).status()).toBe(200)
    expect((await page.request.patch(`${P}/envs/${prod}`, { data: { policy: { protected: true, approvalsRequired: 1, approverIds: null, adminBypass: false } } })).status()).toBe(200)
    expect((await page.request.patch(`${P}/members/${otherId}`, { data: { role: "viewer", envIds: [dev, prod] } })).status()).toBe(200)
    const rb = await other.request.post(`${P}/rollback`, { data: { envId: prod, at: before, apply: true } })
    expect(rb.status()).toBe(403)
    expect(db(`select count(*) from secret_change_requests where project_id = '${id}'`)).toBe("0")
    // The preview stays open to viewers.
    expect((await other.request.post(`${P}/rollback`, { data: { envId: prod, at: before, apply: false } })).status()).toBe(200)

    // 3. Two merges of one approved request at once: one lands, one is refused.
    const sid = db(`select id from secrets where env_id = '${prod}' and key = 'API_KEY'`)
    const cr = (await (await page.request.post(`${P}/secrets`, { data: { envId: prod, ops: [{ id: sid, key: "API_KEY", value: "v2" }] } })).json()).request.id as string
    expect((await page.request.patch(`${P}/members/${otherId}`, { data: { role: "admin", envIds: null } })).status()).toBe(200)
    expect((await other.request.post(`${P}/requests/${cr}`, { data: { action: "approve" } })).status()).toBe(200)
    const merges = await Promise.all([1, 2, 3].map(() => page.request.post(`${P}/requests/${cr}`, { data: { action: "merge" } })))
    expect(merges.map((m) => m.status()).sort()).toEqual([200, 409, 409])
    expect(db(`select count(*) from secret_versions where secret_id = '${sid}'`)).toBe("2")
    // An edit through your own machine token is still yours: you can't approve it.
    const rw = (await (await page.request.post(`${P}/tokens`, { data: { name: "prod-rw", envIds: [prod], access: "rw" } })).json()).token as string
    const tc = await pwRequest.newContext({ baseURL })
    const viaToken = await tc.post(`${API}/secrets`, { headers: { authorization: `Bearer ${rw}` }, data: { env: "production", set: { API_KEY: "v3" } } })
    expect(viaToken.status()).toBe(202)
    const tr = (await viaToken.json()).request as string
    expect((await page.request.post(`${P}/requests/${tr}`, { data: { action: "approve" } })).status()).toBe(403)
    await tc.dispose()

    // 4. Machine token folder scope: a read-write token in "app" can't reach "vault" by
    // writing a reference to it and reading it back expanded.
    for (const name of ["app", "vault"])
      expect((await page.request.post(`${P}/folders`, { data: { envId: dev, parentId: null, name } })).status()).toBe(200)
    const vault = db(`select id from secret_folders where env_id = '${dev}' and name = 'vault'`)
    expect((await page.request.post(`${P}/secrets`, { data: { envId: dev, folderId: vault, ops: [{ key: "TOP", value: "topsecret" }] } })).status()).toBe(200)
    const tok = (await (await page.request.post(`${P}/tokens`, { data: { name: "scoped", envIds: [dev], path: "app", access: "rw" } })).json()).token as string
    const bare = await pwRequest.newContext({ baseURL })
    const auth = { authorization: `Bearer ${tok}` }
    expect((await bare.post(`${API}/secrets`, { headers: auth, data: { env: "development", path: "app", set: { LEAK: "${development.vault.TOP}" } } })).status()).toBe(200)
    expect((await bare.get(`${API}/secrets?env=development&path=vault`, { headers: auth })).status()).toBe(403)
    const got = (await (await bare.get(`${API}/secrets?env=development&path=app&expand=true`, { headers: auth })).json()) as { key: string; value: string }[]
    expect(got.find((r) => r.key === "LEAK")!.value).toBe("${development.vault.TOP}")
    // A token's IP allowlist reads the proxy's address, not the caller's X-Forwarded-For.
    const ipTok = (await (await page.request.post(`${P}/tokens`, { data: { name: "ip", envIds: [dev], ipAllow: ["10.9.8.7"] } })).json()).token as string
    const spoof = await bare.get(`${API}/secrets?env=development`, { headers: { authorization: `Bearer ${ipTok}`, "x-forwarded-for": "10.9.8.7, 127.0.0.1" } })
    expect(spoof.status()).toBe(403)
    await bare.dispose()

    // 5. Parallel wrong unlock tries can't get past the five-try limit.
    await other.request.post(`${API}/lock`)
    const tries = await Promise.all(
      Array.from({ length: 12 }, () => other.request.post(`${API}/unlock`, { data: { method: "password", value: "wrong-password-r1" } }))
    )
    const msgs = await Promise.all(tries.map(async (t) => (await t.json()).message as string))
    expect(msgs.filter((m) => m === "That password isn't right.").length).toBeLessThanOrEqual(4)
    expect((await other.request.post(`${API}/unlock`, { data: { method: "password", value: PASSWORD } })).status()).toBe(401)
    db(`update secret_settings set fails = 0, locked_until = null where user_id = '${otherId}'`)
    expect((await other.request.post(`${API}/unlock`, { data: { method: "password", value: PASSWORD } })).status()).toBe(200)

    // 6. A CLI sign-in follows the admin's idle cap, not just the member's own choice.
    const cli = await pwRequest.newContext({ baseURL })
    const start = await (await cli.post(`${API}/auth/device/start`, { data: { deviceName: unique("r1 cli") } })).json()
    expect((await page.request.post(`${API}/auth/device/approve`, { data: { code: start.userCode, allow: true } })).status()).toBe(200)
    const cliTok = (await (await cli.post(`${API}/auth/device/poll`, { data: { pollToken: start.pollToken } })).json()).token as string
    const cauth = { authorization: `Bearer ${cliTok}` }
    expect((await cli.get(`${API}/projects`, { headers: cauth })).status()).toBe(200)
    const me = db(`select id from "user" where email = '${process.env.E2E_EMAIL ?? "browser-test@example.invalid"}'`)
    const was = db(`select coalesce(secret_max_idle_minutes::text, 'null') from settings`)
    const mine = db(`select lock_minutes from secret_settings where user_id = '${me}'`)
    try {
      db(`update settings set secret_max_idle_minutes = 5`)
      db(`update secret_settings set lock_minutes = 60 where user_id = '${me}'`)
      db(`update secret_unlocks set last_active_at = now() - interval '10 minutes' where user_id = '${me}'`)
      expect((await cli.get(`${API}/projects`, { headers: cauth })).status()).toBe(423)
    } finally {
      db(`update settings set secret_max_idle_minutes = ${was}`)
      db(`update secret_settings set lock_minutes = ${mine} where user_id = '${me}'`)
      db(`update secret_unlocks set last_active_at = now() where user_id = '${me}'`)
    }
    await cli.post(`${API}/auth/logout`, { headers: cauth })
    await cli.dispose()
  } finally {
    await ctx.close()
    db(`update secret_unlocks set last_active_at = now() where unlocked_at is not null and user_id = (select id from "user" where email = '${process.env.E2E_EMAIL ?? "browser-test@example.invalid"}')`)
    await page.request.delete(`${API}/projects/${id}`)
  }
})
