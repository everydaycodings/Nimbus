import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"
import { createHmac } from "node:crypto"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"

import { OTHER, PASSWORD, signIn, unique } from "./helpers"

// Cross-environment references move dependents' versions, and the share link, webhook and
// server push API with CLI and machine tokens. Needs SECRETS_ROOT_KEY and Secrets on.
const API = "/api/v1/secrets"
const db = (q: string) =>
  execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()

async function unlock(page: Page) {
  await page.goto("/secrets")
  await page.getByLabel("Your Nimbus password").fill(PASSWORD)
  await page.getByRole("button", { name: "Unlock", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible()
}

async function seed(page: Page) {
  const made = await (await page.request.post(`${API}/projects`, { data: { name: unique("gaps") } })).json()
  const detail = await (await page.request.get(`${API}/projects/${made.id}`)).json()
  const envs = Object.fromEntries(detail.envs.map((e: { slug: string; id: string }) => [e.slug, e.id])) as Record<string, string>
  return { id: made.id as string, slug: detail.slug as string, envs }
}

const put = async (page: Page, p: { id: string; envs: Record<string, string> }, env: string, key: string, value: string) => {
  const list = (await (await page.request.get(`${API}/projects/${p.id}/secrets?env=${env}`)).json()).secrets as { id: string; key: string }[]
  const id = list.find((s) => s.key === key)?.id
  const r = await page.request.post(`${API}/projects/${p.id}/secrets`, { data: { envId: p.envs[env], ops: [id ? { id, key, value } : { key, value }] } })
  expect(r.status(), await r.text()).toBe(200)
}

// A member's CLI token, approved through the API the approve page uses.
async function cliToken(page: Page, baseURL: string) {
  const cli = await pwRequest.newContext({ baseURL })
  const start = await (await cli.post(`${API}/auth/device/start`, { data: { deviceName: unique("gaps-cli") } })).json()
  expect((await page.request.post(`${API}/auth/device/approve`, { data: { code: start.userCode, allow: true } })).status()).toBe(200)
  const token = (await (await cli.post(`${API}/auth/device/poll`, { data: { pollToken: start.pollToken } })).json()).token as string
  await cli.dispose()
  expect(token).toMatch(/^nmu_/)
  return token
}
const bearer = (baseURL: string, token: string) => pwRequest.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${token}` } })

test("changing a referenced environment moves every dependent's version, through cycles too", async ({ page, baseURL }) => {
  await signIn(page)
  await unlock(page)
  const p = await seed(page)
  try {
    const { development: dev, staging, production: prod } = p.envs
    await put(page, p, "production", "API_KEY", "one")
    await put(page, p, "staging", "KEY", "${production.API_KEY}")
    await put(page, p, "development", "VIA", "${staging.KEY}")
    const tok = (await (await page.request.post(`${API}/projects/${p.id}/tokens`, { data: { name: "gaps ro", envIds: [dev, staging, prod] } })).json()).token as string
    const m = await bearer(baseURL!, tok)
    const version = async (env: string) => (await (await m.get(`${API}/secrets/version?env=${env}`)).json()).version as number
    const before = { dev: await version("development"), staging: await version("staging"), prod: await version("production") }

    // A webhook on staging hears about it, with no key names (none of staging's own changed).
    const hook = (await (await page.request.post(`${API}/projects/${p.id}/envs/${staging}/webhooks`, { data: { url: "http://127.0.0.1:9/never" } })).json()).id as string
    // A long poll on staging returns as soon as production changes.
    const watch = m.get(`${API}/secrets/watch?env=staging&version=${before.staging}&timeout=20`)
    await put(page, p, "production", "API_KEY", "two")
    expect(await (await watch).json()).toMatchObject({ changed: true })
    expect(await version("production")).toBe(before.prod + 1)
    expect(await version("staging")).toBe(before.staging + 1)
    expect(await version("development")).toBe(before.dev + 1)
    const via = (await (await m.get(`${API}/secrets?env=development&expand=true`)).json()) as { key: string; value: string }[]
    expect(via.find((s) => s.key === "VIA")?.value).toBe("two")
    expect(db(`select payload::json->>'keys' from secret_webhook_deliveries where webhook_id='${hook}'`)).toBe("[]")

    // Nothing references development, so staging stays; then a cycle (prod -> dev -> staging -> prod) still ends.
    await put(page, p, "development", "OTHER", "x")
    expect(await version("staging")).toBe(before.staging + 1)
    await put(page, p, "production", "LOOP", "${development.VIA}")
    await put(page, p, "staging", "KEY", "${production.API_KEY}!")
    expect(await version("staging")).toBe(before.staging + 3) // two (via prod), LOOP (via prod), KEY
    expect(await version("development")).toBe(before.dev + 4) // two, OTHER, LOOP, KEY: all through staging
    expect(await version("production")).toBe(before.prod + 3) // two, LOOP, and staging's KEY through LOOP
    await m.dispose()
  } finally {
    await page.request.delete(`${API}/projects/${p.id}`)
  }
})

test("share links, webhooks and server push over the API with CLI and machine tokens", async ({ page, browser, baseURL }) => {
  await signIn(page)
  await unlock(page)
  const p = await seed(page)
  const got: { sig: string; body: string }[] = []
  const recv = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c)).on("end", () => {
      got.push({ sig: String(req.headers["x-nimbus-signature"]), body })
      res.end("ok")
    })
  })
  await new Promise<void>((r) => recv.listen(0, "127.0.0.1", r))
  const hookUrl = `http://127.0.0.1:${(recv.address() as AddressInfo).port}/hook`
  const label = unique("gaps share")
  let member: APIRequestContext | undefined
  try {
    const token = await cliToken(page, baseURL!)
    member = await bearer(baseURL!, token)
    const mk = async (access: "ro" | "rw") =>
      bearer(baseURL!, (await (await page.request.post(`${API}/projects/${p.id}/tokens`, { data: { name: `gaps ${access}`, envIds: [p.envs.production], access } })).json()).token)
    const ro = await mk("ro")
    const rw = await mk("rw")

    // ---- share links: a member's CLI token only ----
    const made = await member.post(`${API}/shares`, { data: { text: "hello outsider", minutes: 60, maxViews: 1, password: "pw-123", label } })
    expect(made.status()).toBe(200)
    const share = await made.json()
    expect(share.url).toMatch(new RegExp(`/s/${share.token}$`))
    const mine = (await (await member.get(`${API}/shares`)).json()).shares as { id: string; label: string; state: string; password: boolean }[]
    const row = mine.find((s) => s.label === label)!
    expect(row).toMatchObject({ state: "active", password: true })
    expect((await rw.post(`${API}/shares`, { data: { text: "x", minutes: 60, maxViews: 1 } })).status()).toBe(403)
    expect((await member.post(`${API}/shares`, { data: { text: "x", minutes: 5, maxViews: 1 } })).status()).toBe(400)
    expect((await member.delete(`${API}/shares?id=${row.id}`)).status()).toBe(200)
    expect((await (await member.get(`${API}/shares`)).json()).shares.find((s: { id: string }) => s.id === row.id).state).toBe("revoked")

    // ---- webhooks, by slug: admins only ----
    const W = `${API}/projects/${p.slug}/envs/production/webhooks`
    const hook = await (await member.post(W, { data: { url: hookUrl } })).json()
    expect(hook.secret).toMatch(/^whsec_/)
    expect((await (await member.get(W)).json()).hooks.map((h: { id: string }) => h.id)).toEqual([hook.id])
    expect(await (await member.post(`${W}/${hook.id}/test`)).json()).toMatchObject({ status: "delivered", httpStatus: 200 })
    expect(got[0].sig).toBe(`sha256=${createHmac("sha256", hook.secret).update(got[0].body).digest("hex")}`)
    expect(JSON.parse(got[0].body)).toMatchObject({ event: "test", env: { slug: "production" } })
    expect((await member.patch(`${W}/${hook.id}`, { data: { enabled: false } })).status()).toBe(200)
    for (const t of [ro, rw]) expect((await t.get(W)).status()).toBe(403)
    expect((await member.get(`${API}/projects/${p.slug}/envs/nope/webhooks`)).status()).toBe(404)
    expect((await member.delete(`${W}/${hook.id}`)).status()).toBe(200)

    // ---- server push: admins set it up; a read-write machine token may only run it ----
    const P = `${API}/projects/${p.slug}/envs/production/push`
    const key = execFileSync("sh", ["-c", "d=$(mktemp -d) && ssh-keygen -q -t ed25519 -N '' -f $d/k && cat $d/k && rm -r $d"]).toString()
    expect((await member.put(P, { data: { host: "127.0.0.1", port: 1, username: "deploy", path: "/tmp/app.env", privateKey: key, postCommand: "true" } })).status()).toBe(200)
    expect(await (await member.get(`${API}/projects/${p.slug}/push`)).json()).toMatchObject({ targets: [{ env: "production", host: "127.0.0.1", port: 1, username: "deploy" }] })
    expect(JSON.stringify(await (await member.get(P)).json())).not.toContain("PRIVATE KEY")
    const run = await member.post(P)
    expect(run.status()).toBe(502)
    expect((await run.json()).error.code).toBe("bad_gateway")
    expect((await rw.post(P)).status()).toBe(502) // allowed: it got as far as connecting
    expect((await ro.post(P)).status()).toBe(403)
    expect((await rw.put(P, { data: { host: "evil", username: "x", path: "/x" } })).status()).toBe(403)
    expect((await rw.get(`${API}/projects/${p.slug}/push`)).status()).toBe(403)
    expect((await member.delete(P)).status()).toBe(200)
    expect((await (await member.get(`${API}/projects/${p.slug}/push`)).json()).targets).toEqual([])

    // ---- a Developer's CLI token can't manage either ----
    expect((await page.request.post(`${API}/projects/${p.id}/members`, { data: { email: OTHER, role: "developer", envIds: null } })).status()).toBe(200)
    const ctx = await browser.newContext({ baseURL })
    const other = await ctx.newPage()
    await other.waitForTimeout(10_500) // sign-in allows 3 tries per 10 seconds
    await signIn(other, OTHER)
    await unlock(other)
    const dev = await bearer(baseURL!, await cliToken(other, baseURL!))
    expect((await dev.get(W)).status()).toBe(403)
    expect((await dev.post(P)).status()).toBe(403)
    await dev.post(`${API}/auth/logout`)
    await ctx.close()

    // ---- everything above is in the project's audit log, with the CLI marker ----
    const actions = db(`select string_agg(distinct action, ',' order by action) from audit_events where project_id='${p.id}' and detail like '%(CLI,%'`)
    for (const a of ["secrets_webhook_add", "secrets_webhook_test", "secrets_webhook_edit", "secrets_webhook_remove", "secrets_webhook_list", "secrets_push_save", "secrets_push_run", "secrets_push_remove", "secrets_push_list"])
      expect(actions.split(",")).toContain(a)
    expect(db(`select count(*) from audit_events where action='secrets_push_run' and project_id='${p.id}' and detail like '%machine token%'`)).toBe("1")
    expect(db(`select count(*) from audit_events where action in ('secrets_share_create','secrets_share_revoke') and detail like '%${label}%(CLI,%'`)).toBe("2")
    await member.post(`${API}/auth/logout`)
  } finally {
    recv.close()
    await member?.dispose()
    await page.request.delete(`${API}/projects/${p.id}`)
    db(`delete from secret_shares where label='${label}'`)
    db(`delete from secret_cli_tokens where name like 'e2e % gaps-cli%'`)
  }
})
