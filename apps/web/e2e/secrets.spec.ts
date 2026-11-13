import { expect, request as pwRequest, test, type Page } from "@playwright/test"

import { createServer } from "node:http"
import { createHmac } from "node:crypto"
import { execFileSync } from "node:child_process"

import { OTHER, PASSWORD, signIn, unique } from "./helpers"

// Needs SECRETS_ROOT_KEY on the server and Secrets on (Admin → Secrets).
async function unlock(page: Page) {
  await page.goto("/secrets")
  await page.getByLabel("Your Nimbus password").fill(PASSWORD)
  await page.getByRole("button", { name: "Unlock", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible()
}

async function addRow(page: Page, key: string, value: string) {
  await page.getByRole("button", { name: "Add secret" }).click()
  await page.getByLabel("New secret key").fill(key)
  await page.getByLabel("New secret value").fill(value)
}

test("projects, secrets, reveal, overview, import, trash and the lock", async ({ page }) => {
  await signIn(page)
  await unlock(page)

  // A project starts with three environments.
  const name = unique("project")
  await page.getByRole("button", { name: "New project" }).first().click()
  await page.getByLabel("Name", { exact: true }).fill(name)
  await page.getByRole("button", { name: "Create project" }).click()
  await expect(page.getByRole("heading", { name })).toBeVisible()
  for (const e of ["Development", "Staging", "Production"])
    await expect(page.getByRole("button", { name: e, exact: true })).toBeVisible()

  // Add two secrets in Development, one of them referencing the other, then save.
  await page.getByRole("button", { name: "Development", exact: true }).click()
  await addRow(page, "DB_HOST", "db.dev.local")
  await page.getByRole("button", { name: "Add secret" }).click()
  await page.getByLabel("New secret key").first().fill("DB_URL")
  await page.getByLabel("New secret value").first().fill("pg://${DB_HOST}:5432")
  await expect(page.getByText("2 unsaved changes")).toBeVisible()
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("unsaved change")).toBeHidden()

  // Values are masked until clicked; revealing shows the resolved reference.
  await expect(page.getByLabel("Value of DB_HOST", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Reveal value of DB_URL" }).first().click()
  await expect(page.getByLabel("Value of DB_URL", { exact: true })).toHaveValue("pg://${DB_HOST}:5432")
  await page.getByRole("button", { name: "Details for DB_URL" }).click()
  await expect(page.getByText("pg://db.dev.local:5432")).toBeVisible()

  // A typed value is validated on save.
  await page.getByLabel("Type", { exact: true }).selectOption("number")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Not a number.")).toBeVisible()
  await page.getByRole("button", { name: "Discard" }).click()

  // A circular reference is refused.
  await page.getByRole("button", { name: "Reveal value of DB_HOST" }).first().click()
  await page.getByLabel("Value of DB_HOST", { exact: true }).fill("${DB_URL}")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText(/Circular reference/).first()).toBeVisible()
  await page.getByRole("button", { name: "Discard" }).click()

  // Overview: Development has the keys, Staging is missing them.
  await page.getByRole("button", { name: "Overview" }).click()
  await expect(page.getByRole("button", { name: /DB_HOST is missing in Staging/ })).toBeVisible()

  // Import a .env into Staging with a preview.
  await page.getByRole("button", { name: "Staging", exact: true }).click()
  await page.getByRole("button", { name: "Import" }).click()
  await page.getByLabel("Paste here").fill("DB_HOST=db.staging\nNEW_ONE=1\nNEW_ONE=2")
  await page.getByRole("button", { name: "Preview" }).click()
  await expect(page.getByText("2 new")).toBeVisible()
  await expect(page.getByText("Duplicate (later one wins)")).toBeVisible()
  await page.getByRole("button", { name: /Import 2 secrets/ }).click()
  await expect(page.getByLabel("Key of NEW_ONE")).toBeVisible()

  // Search finds names, never values.
  await page.getByLabel("Search key names, comments and tags").fill("NEW_")
  await expect(page.getByText("1 match")).toBeVisible()
  await page.getByLabel("Search key names, comments and tags").fill("db.staging")
  await expect(page.getByText(/Nothing matches/)).toBeVisible()
  await page.getByRole("button", { name: "Clear search" }).click()

  // Delete goes to the trash and comes back.
  await page.getByRole("button", { name: "Delete NEW_ONE" }).click()
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByLabel("Key of NEW_ONE")).toHaveCount(0)
  await page.getByRole("button", { name: /^Trash/ }).click()
  await page.getByLabel("Select NEW_ONE").check()
  await page.getByRole("button", { name: "Restore" }).click()
  await expect(page.getByText("Trash is empty")).toBeVisible()

  // The server enforces the lock, not just the page.
  const open = await page.request.get("/api/v1/secrets/projects")
  expect(open.status()).toBe(200)
  await page.getByRole("button", { name: "Lock now" }).click()
  await expect(page.getByRole("heading", { name: "Secrets are locked" })).toBeVisible()
  const locked = await page.request.get("/api/v1/secrets/projects")
  expect(locked.status()).toBe(423)

  // Clean up.
  await unlock(page)
  await page.getByRole("link", { name: new RegExp(name) }).click()
  await page.getByRole("button", { name: "Project settings" }).click()
  await page.getByRole("menuitem", { name: "Delete project" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Delete project" }).click()
  await expect(page).toHaveURL(/\/secrets$/)
})

test("phone width keeps rows readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await signIn(page)
  await unlock(page)
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  expect(scroll).toBe(true)
})

const API = "/api/v1/secrets"

// A project made through the API, with a secret in Development and Production.
async function seedProject(page: Page) {
  const name = unique("access")
  const made = await (await page.request.post(`${API}/projects`, { data: { name } })).json()
  const detail = await (await page.request.get(`${API}/projects/${made.id}`)).json()
  const envs = Object.fromEntries(detail.envs.map((e: { slug: string; id: string }) => [e.slug, e.id]))
  for (const [slug, value] of [["development", "dev-value"], ["production", "prod-value"]]) {
    const r = await page.request.post(`${API}/projects/${made.id}/secrets`, {
      data: { envId: envs[slug], ops: [{ key: "API_KEY", value }] },
    })
    expect(r.status()).toBe(200)
  }
  return { id: made.id as string, name, envs, slug: detail.slug as string }
}

test("roles with per-environment access, machine tokens and the lock", async ({ page, browser, baseURL }) => {
  await signIn(page)
  await unlock(page)
  const p = await seedProject(page)

  // Add a developer who gets Development only.
  await page.goto(`/secrets/${p.id}?view=access`)
  await page.getByRole("button", { name: "Add member" }).click()
  await page.getByLabel("Their Nimbus email").fill(OTHER)
  await page.getByLabel("Role").selectOption("developer")
  await page.getByLabel("All environments").uncheck()
  await page.getByRole("dialog").getByLabel("Development").check()
  await page.getByRole("dialog").getByRole("button", { name: "Add member" }).click()
  await expect(page.getByText("Development", { exact: true }).first()).toBeVisible()

  // Their view: no Production, no Access tab; the API agrees.
  const ctx = await browser.newContext({ baseURL })
  const other = await ctx.newPage()
  // Sign-in allows 3 tries per 10 seconds.
  await other.waitForTimeout(10_500)
  await signIn(other, OTHER)
  await unlock(other)
  await other.goto(`/secrets/${p.id}`)
  await expect(other.getByRole("heading", { name: p.name })).toBeVisible()
  await expect(other.getByRole("button", { name: "Development", exact: true })).toBeVisible()
  await expect(other.getByRole("button", { name: "Production", exact: true })).toHaveCount(0)
  await expect(other.getByRole("button", { name: "Access", exact: true })).toHaveCount(0)
  expect((await other.request.get(`${API}/projects/${p.id}/secrets?env=production`)).status()).toBe(404)
  expect((await other.request.get(`${API}/projects/${p.id}/members`)).status()).toBe(403)
  const dev = await other.request.get(`${API}/projects/${p.id}/secrets?env=development&values=true`)
  expect((await dev.json()).secrets[0].value).toBe("dev-value")
  const reveal = await other.request.post(`${API}/projects/${p.id}/secrets/reveal`, { data: { ids: [(await (await other.request.get(`${API}/projects/${p.id}/secrets?env=development`)).json()).secrets[0].id] } })
  expect(reveal.status()).toBe(200)
  const write = (env: string) =>
    other.request.post(`${API}/projects/${p.id}/secrets`, { data: { envId: p.envs[env], ops: [{ key: "EXTRA", value: "1" }] } })
  expect((await write("development")).status()).toBe(200)
  expect((await write("production")).status()).toBe(404)
  // Reveal by id can't reach Production either (an id from the owner).
  const prodId = (await (await page.request.get(`${API}/projects/${p.id}/secrets?env=production`)).json()).secrets[0].id
  expect((await (await other.request.post(`${API}/projects/${p.id}/secrets/reveal`, { data: { ids: [prodId] } })).json()).values).toEqual([])

  // The owner makes them a viewer: reading still works, writing is refused.
  await page.reload()
  await page.getByRole("button", { name: "Change New Bie" }).click()
  await page.getByRole("dialog").getByLabel("Role").selectOption("viewer")
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click()
  await expect.poll(async () => (await write("development")).status()).toBe(403)
  expect((await other.request.get(`${API}/projects/${p.id}/secrets?env=development`)).status()).toBe(200)

  // A machine token for Development.
  await page.getByRole("tab", { name: "Machine tokens" }).click()
  await page.getByRole("button", { name: "New token" }).click()
  await page.getByLabel("Name", { exact: true }).fill("ci")
  await page.getByRole("dialog").getByLabel("Development").check()
  await page.getByRole("button", { name: "Create token" }).click()
  const token = (await page.getByTestId("new-token").textContent())!.trim()
  expect(token).toMatch(/^nms_/)
  await page.getByRole("button", { name: "Done" }).click()
  await expect(page.getByRole("button", { name: "Revoke ci" })).toBeVisible()

  // The token never meets the unlock: lock the browser, the fetch still works.
  await page.getByRole("button", { name: "Lock now" }).click()
  await expect(page.getByRole("heading", { name: "Secrets are locked" })).toBeVisible()
  const bare = await pwRequest.newContext({ baseURL })
  const auth = { authorization: `Bearer ${token}` }
  const got = await bare.get(`${API}/secrets?env=development`, { headers: auth })
  expect(got.status()).toBe(200)
  expect(await got.json()).toEqual([{ key: "API_KEY", value: "dev-value", type: "string", comment: "" }, { key: "EXTRA", value: "1", type: "string", comment: "" }])
  const etag = got.headers().etag
  expect(etag).toMatch(/^"\d+"$/)
  expect((await bare.get(`${API}/secrets?env=development`, { headers: { ...auth, "if-none-match": etag } })).status()).toBe(304)
  expect((await bare.get(`${API}/secrets?env=production`, { headers: auth })).status()).toBe(403)
  expect((await bare.get(`${API}/secrets?env=development`)).status()).toBe(401)
  expect((await bare.get(`${API}/secrets?env=development`, { headers: { authorization: "Bearer nms_nope" } })).status()).toBe(401)
  const who = await (await bare.get(`${API}/whoami`, { headers: auth })).json()
  expect(who).toMatchObject({ type: "machine", name: "ci", scope: { project: p.slug, env: "development", access: "ro" } })
  const ver = await (await bare.get(`${API}/secrets/version?env=development`, { headers: auth })).json()
  expect(ver.etag).toBe(etag)
  // A read-only token can't write; and a change moves the version and wakes the watcher.
  expect((await bare.post(`${API}/secrets`, { headers: auth, data: { env: "development", set: { A: "b" } } })).status()).toBe(403)
  const watch = bare.get(`${API}/secrets/watch?env=development&version=${ver.version}&timeout=20`, { headers: auth })
  await unlock(page)
  await page.goto(`/secrets/${p.id}`)
  expect((await page.request.post(`${API}/projects/${p.id}/secrets`, { data: { envId: p.envs.development, ops: [{ key: "LATE", value: "x" }] } })).status()).toBe(200)
  expect(await (await watch).json()).toMatchObject({ changed: true, version: ver.version + 1 })

  // Revoking stops it at once.
  await page.goto(`/secrets/${p.id}?view=access`)
  await page.getByRole("tab", { name: "Machine tokens" }).click()
  await page.getByRole("button", { name: "Revoke ci" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Revoke token" }).click()
  await expect(page.getByText("Revoked")).toBeVisible()
  expect((await bare.get(`${API}/secrets?env=development`, { headers: auth })).status()).toBe(401)

  // Removing the member closes the project to them.
  await page.getByRole("tab", { name: "Members" }).click()
  await page.getByRole("button", { name: "Remove New Bie" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click()
  await expect.poll(async () => (await other.request.get(`${API}/projects/${p.id}`)).status()).toBe(404)
  await ctx.close()

  await page.request.delete(`${API}/projects/${p.id}`)
})

test("signing in the command line from the approve page", async ({ page, baseURL }) => {
  await signIn(page)
  await unlock(page)
  const cli = await pwRequest.newContext({ baseURL })
  const device = unique("laptop")
  const start = await (await cli.post(`${API}/auth/device/start`, { data: { deviceName: device } })).json()
  expect(start.verifyUrl).toContain(`/secrets/cli?code=${start.userCode}`)
  expect((await cli.post(`${API}/auth/device/poll`, { data: { pollToken: start.pollToken } })).status()).toBe(202)

  await page.goto(new URL(start.verifyUrl).pathname + new URL(start.verifyUrl).search)
  await expect(page.getByRole("region", { name: "Approve sign-in" }).getByText(device)).toBeVisible()
  await expect(page.getByTestId("device-code")).toHaveText(start.userCode)
  await page.getByRole("button", { name: "Approve" }).click()
  await expect(page.getByText(/Approved/)).toBeVisible()

  const poll = await cli.post(`${API}/auth/device/poll`, { data: { pollToken: start.pollToken } })
  expect(poll.status()).toBe(200)
  const { token, user } = await poll.json()
  expect(token).toMatch(/^nmu_/)
  expect(user.email).toBeTruthy()
  // Collected once.
  expect((await cli.post(`${API}/auth/device/poll`, { data: { pollToken: start.pollToken } })).status()).toBe(410)
  const auth = { authorization: `Bearer ${token}` }
  expect((await cli.get(`${API}/whoami`, { headers: auth })).status()).toBe(200)
  const projects = await cli.get(`${API}/projects`, { headers: auth })
  expect(projects.status()).toBe(200)
  expect(Array.isArray((await projects.json()).projects)).toBe(true)

  // A member's CLI follows the unlock; a refused code never yields a token.
  await page.getByRole("button", { name: "Lock now" }).click()
  await expect(page.getByRole("heading", { name: "Secrets are locked" })).toBeVisible()
  const locked = await cli.get(`${API}/projects`, { headers: auth })
  expect(locked.status()).toBe(423)
  expect((await locked.json()).error.code).toBe("locked")
  const denied = await (await cli.post(`${API}/auth/device/start`, { data: { deviceName: "nope" } })).json()
  await unlock(page)
  await page.goto(`/secrets/cli?code=${denied.userCode}`)
  await page.getByRole("button", { name: "Refuse" }).click()
  await expect(page.getByText(/Refused/)).toBeVisible()
  expect((await cli.post(`${API}/auth/device/poll`, { data: { pollToken: denied.pollToken } })).status()).toBe(403)

  // The page lists it; signing it out kills the token.
  await page.goto("/secrets/cli")
  await page.getByRole("button", { name: `Sign out ${device}` }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click()
  await expect(page.getByText(device)).toHaveCount(0)
  expect((await cli.get(`${API}/whoami`, { headers: auth })).status()).toBe(401)
})

test("webhooks are signed, name keys only and log deliveries", async ({ page }) => {
  await signIn(page)
  await unlock(page)
  const p = await seedProject(page)
  const got: { body: string; sig: string }[] = []
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      got.push({ body, sig: String(req.headers["x-nimbus-signature"]) })
      res.writeHead(204).end()
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`
  try {
    await page.goto(`/secrets/${p.id}?view=access`)
    await page.getByRole("tab", { name: "Webhooks" }).click()
    await page.getByLabel("Webhook URL").fill(url)
    await page.getByRole("button", { name: "Add webhook" }).click()
    const secret = (await page.getByTestId("webhook-secret").textContent())!.trim()
    await page.getByRole("button", { name: "Done" }).click()
    await page.getByRole("button", { name: "Test", exact: true }).click()
    await expect(page.getByText("Test delivered (204).")).toBeVisible()
    await expect(page.getByRole("list", { name: "Delivery log" })).toContainText("delivered")
    expect(got).toHaveLength(1)
    expect(got[0].sig).toBe(`sha256=${createHmac("sha256", secret).update(got[0].body).digest("hex")}`)
    const payload = JSON.parse(got[0].body)
    expect(payload).toMatchObject({ event: "test", project: { name: p.name }, env: { slug: "development" } })
    expect(got[0].body).not.toContain("dev-value")

    // A bad key is refused on the push form.
    await page.getByRole("tab", { name: "Server push" }).click()
    await page.getByLabel("Host").fill("localhost")
    await page.getByLabel("User", { exact: true }).fill("deploy")
    await page.getByLabel("File on the server").fill("/tmp/.env")
    await page.getByLabel("Private key").fill("not a key")
    await page.getByRole("button", { name: "Set up push" }).click()
    await expect(page.getByText("That isn't a private key we can read.")).toBeVisible()
  } finally {
    server.close()
    await page.request.delete(`${API}/projects/${p.id}`)
  }
})

// ---- S3: governance ----

const db = (q: string) =>
  execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()

// The worker's hourly sweep, run by hand through /api/jobs (what the worker forwards).
async function sweep(page: Page) {
  const token = execFileSync("node", [
    "--env-file=.env.local",
    "--input-type=module",
    "-e",
    "import {signToken} from './lib/upload-rules.ts'; console.log(signToken('job',{},60000))",
  ]).toString().trim()
  const r = await page.request.post("/api/jobs", { headers: { authorization: `Bearer ${token}` }, data: { name: "secrets-sweep", data: {} } })
  expect(r.status()).toBe(204)
}

const idOf = async (page: Page, pid: string, env: string, key: string) =>
  ((await (await page.request.get(`${API}/projects/${pid}/secrets?env=${env}`)).json()).secrets as { id: string; key: string }[]).find((s) => s.key === key)!.id
const valueOf = async (page: Page, pid: string, env: string, key: string) =>
  ((await (await page.request.get(`${API}/projects/${pid}/secrets?env=${env}&values=true`)).json()).secrets as { key: string; value: string }[]).find((s) => s.key === key)?.value

test("history restore, snapshot rollback, required-key drift and a one-time share", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000)
  await page.waitForTimeout(10_500)
  await signIn(page)
  await unlock(page)
  const p = await seedProject(page)
  const dev = p.envs.development

  // Three moments (a save is one moment; rows within 3 seconds group together).
  const id = await idOf(page, p.id, "development", "API_KEY")
  await page.waitForTimeout(3300)
  await page.request.post(`${API}/projects/${p.id}/secrets`, { data: { envId: dev, ops: [{ id, key: "API_KEY", value: "two" }] } })
  await page.waitForTimeout(3300)
  await page.request.post(`${API}/projects/${p.id}/secrets`, { data: { envId: dev, ops: [{ id, key: "API_KEY", value: "three" }, { key: "EXTRA", value: "x" }] } })
  await page.waitForTimeout(3300)

  // History: three versions, compare is masked until revealed, restore writes a new version.
  await page.goto(`/secrets/${p.id}?view=development`)
  await page.getByRole("button", { name: "Details for API_KEY" }).click()
  await page.getByRole("button", { name: /^History/ }).click()
  const hist = page.getByRole("dialog", { name: "History of API_KEY" })
  await expect(hist.getByText("v3", { exact: true })).toBeVisible()
  await expect(hist.getByText("v1", { exact: true })).toBeVisible()
  await hist.getByRole("button", { name: "Compare version 1 with the current value" }).click()
  await expect(hist.getByText("dev-value")).toHaveCount(0)
  await hist.getByRole("button", { name: "Reveal both values" }).click()
  await expect(hist.getByLabel("Comparison")).toContainText("dev-value")
  await expect(hist.getByLabel("Comparison")).toContainText("three")
  await hist.getByRole("button", { name: "Restore version 1" }).click()
  await page.getByRole("dialog").filter({ hasText: "Restore version 1?" }).getByRole("button", { name: "Restore", exact: true }).click()
  await expect(hist.getByText("v4", { exact: true })).toBeVisible()
  expect(await valueOf(page, p.id, "development", "API_KEY")).toBe("dev-value")
  await page.keyboard.press("Escape")

  // The audit log saw the reveal.
  const audit = await (await page.request.get(`${API}/projects/${p.id}/audit?action=secrets_reveal`)).json()
  expect(audit.rows.length).toBeGreaterThan(0)
  expect(audit.rows[0].ip).toBeTruthy()

  // Snapshots: go back to the "two" moment; the preview names both changes before anything is written.
  await page.getByRole("button", { name: "Snapshots" }).click()
  await expect(page.getByRole("list", { name: "Timeline" }).getByRole("listitem")).toHaveCount(4)
  await page.getByRole("button", { name: /Preview going back/ }).nth(1).click()
  const prev = page.getByRole("dialog", { name: "Roll back to this moment?" })
  await expect(prev.getByRole("list", { name: "What would change" })).toContainText("EXTRA")
  await expect(prev.getByRole("list", { name: "What would change" })).toContainText("API_KEY")
  expect(await valueOf(page, p.id, "development", "EXTRA")).toBe("x")
  await prev.getByRole("button", { name: "Apply rollback" }).click()
  await page.getByRole("dialog").filter({ hasText: "Apply the rollback?" }).getByRole("button", { name: "Apply rollback" }).click()
  await expect.poll(() => valueOf(page, p.id, "development", "API_KEY")).toBe("two")
  expect(await valueOf(page, p.id, "development", "EXTRA")).toBeUndefined()
  // History is never rewritten: the rolled-back secret has more versions, not fewer.
  const h = await (await page.request.get(`${API}/projects/${p.id}/history?secretId=${id}`)).json()
  expect(h.versions.length).toBe(5)
  expect(h.versions[0].action).toBe("rollback")

  // Required keys: a URL-shaped DATABASE_URL, flagged missing in Staging; a bad value is refused.
  await page.getByRole("button", { name: "Policies" }).click()
  await page.getByLabel("Key", { exact: true }).fill("DATABASE_URL")
  await page.getByLabel("Value must be").selectOption("url")
  await page.getByRole("button", { name: "Require key" }).click()
  await expect(page.getByText("a URL", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Development", exact: true }).click()
  await addRow(page, "DATABASE_URL", "not a url")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText(/this key's required format/)).toBeVisible()
  await page.getByLabel("New secret value").fill("https://db.example.com")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("unsaved change")).toBeHidden()
  await page.getByRole("button", { name: "Overview" }).click()
  await expect(page.getByRole("button", { name: /DATABASE_URL is missing in Staging/ })).toBeVisible()
  await expect(page.getByText("required", { exact: true })).toBeVisible()
  // Tighten the rule: the existing value no longer fits and the matrix says so.
  await page.getByRole("button", { name: "Policies" }).click()
  await page.getByLabel("Key", { exact: true }).fill("DATABASE_URL")
  await page.getByLabel("Value must be").selectOption("int")
  await page.getByRole("button", { name: "Require key" }).click()
  await page.getByRole("button", { name: "Overview" }).click()
  await expect(page.getByRole("button", { name: /DATABASE_URL in Development: invalid/ })).toBeVisible()

  // A one-time share: opens for someone with no account, once.
  await page.getByRole("button", { name: "Development", exact: true }).click()
  await page.getByRole("button", { name: "Details for API_KEY" }).click()
  await page.getByRole("button", { name: "Share once" }).click()
  await page.getByRole("button", { name: "Create link" }).click()
  const url = await page.getByLabel("Your link").inputValue()
  expect(url).toMatch(/\/s\/ns_/)
  await page.getByRole("button", { name: "Done" }).click()
  const anon = await browser.newContext({ baseURL })
  const visitor = await anon.newPage()
  await visitor.goto(url)
  await expect(visitor.getByText("two")).toHaveCount(0)
  await visitor.getByRole("button", { name: "Reveal" }).click()
  await expect(visitor.getByLabel("The shared text")).toHaveText("two")
  await visitor.reload()
  await expect(visitor.getByRole("heading", { name: "This link doesn't work" })).toBeVisible()
  const token = url.split("/s/")[1]
  expect((await anon.request.post(`/api/secret-share/${token}`, { data: {} })).status()).toBe(410)
  await anon.close()
  await page.getByRole("button", { name: "Share links" }).click()
  await expect(page.getByText("viewed", { exact: true }).first()).toBeVisible()

  await page.request.delete(`${API}/projects/${p.id}`)
})

test("protected environment: a second member approves and merges; stale requests conflict; access requests expire", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000)
  await page.waitForTimeout(10_500)
  await signIn(page)
  await unlock(page)
  const p = await seedProject(page)
  const prod = p.envs.production

  // OTHER joins as a developer and is the only approver for Production.
  expect((await page.request.post(`${API}/projects/${p.id}/members`, { data: { email: OTHER, role: "developer", envIds: null } })).status()).toBe(200)
  const members = (await (await page.request.get(`${API}/projects/${p.id}/members`)).json()).members as { userId: string; email: string }[]
  const otherId = members.find((m) => m.email === OTHER)!.userId
  const protect = await page.request.patch(`${API}/projects/${p.id}/envs/${prod}`, {
    data: { policy: { protected: true, approvalsRequired: 1, approverIds: [otherId], adminBypass: false } },
  })
  expect(protect.status()).toBe(200)

  // The owner's save becomes a request; production is untouched.
  await page.goto(`/secrets/${p.id}?view=production`)
  await expect(page.getByText("Production is protected")).toBeVisible()
  await page.getByRole("button", { name: "Reveal value of API_KEY" }).first().click()
  await page.getByLabel("Value of API_KEY", { exact: true }).fill("prod-new")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByText("Sent for review").first()).toBeVisible()
  expect(await valueOf(page, p.id, "production", "API_KEY")).toBe("prod-value")
  await page.reload()
  await expect(page.getByRole("button", { name: "Change requests 1 waiting" })).toBeVisible()

  // The second member sees it, reveals the diff, approves.
  const ctx = await browser.newContext({ baseURL })
  const other = await ctx.newPage()
  await other.waitForTimeout(10_500)
  await signIn(other, OTHER)
  await unlock(other)
  const bell = await (await other.request.get("/api/v1/notifications")).json()
  expect(JSON.stringify(bell.items)).toContain("wants to change 1 secret")
  await other.goto(`/secrets/${p.id}?view=requests`)
  await other.getByRole("button", { name: /Production.* · 1 change/ }).click()
  await expect(other.getByRole("list", { name: "Changes" })).toContainText("API_KEY")
  await expect(other.getByText("prod-new")).toHaveCount(0)
  await other.getByRole("button", { name: "Reveal the values of API_KEY" }).click()
  await expect(other.getByText("− prod-value")).toBeVisible()
  await expect(other.getByText("+ prod-new")).toBeVisible()
  await other.getByLabel("Write a comment").fill("looks right")
  await other.getByRole("button", { name: "Comment", exact: true }).click()
  await expect(other.getByText("looks right")).toBeVisible()
  await other.getByRole("button", { name: "Approve" }).click()
  await expect(other.getByText("Approved, ready to merge")).toBeVisible()
  // The author can't approve their own; the approver can't be bypassed through the API either.
  const rid = (await (await page.request.get(`${API}/projects/${p.id}/requests`)).json()).requests[0].id as string
  expect((await page.request.post(`${API}/projects/${p.id}/requests/${rid}`, { data: { action: "approve" } })).status()).toBe(403)

  // The owner merges.
  await page.goto(`/secrets/${p.id}?view=requests&request=${rid}`)
  await page.getByRole("button", { name: "Merge", exact: true }).click()
  await expect.poll(() => valueOf(page, p.id, "production", "API_KEY")).toBe("prod-new")
  const owner = await (await page.request.get("/api/v1/notifications")).json()
  expect(JSON.stringify(owner.items)).toContain("was approved")

  // Two requests on the same key: merging one makes the other stale.
  const asReq = async (value: string) => {
    const id = await idOf(page, p.id, "production", "API_KEY")
    const r = await page.request.post(`${API}/projects/${p.id}/secrets`, { data: { envId: prod, ops: [{ id, key: "API_KEY", value }] } })
    expect(r.status()).toBe(200)
    return (await r.json()).request.id as string
  }
  const r2 = await asReq("r2")
  const r3 = await asReq("r3")
  for (const r of [r2, r3]) expect((await other.request.post(`${API}/projects/${p.id}/requests/${r}`, { data: { action: "approve" } })).status()).toBe(200)
  expect((await page.request.post(`${API}/projects/${p.id}/requests/${r3}`, { data: { action: "merge" } })).status()).toBe(200)
  const stale = await page.request.post(`${API}/projects/${p.id}/requests/${r2}`, { data: { action: "merge" } })
  expect(stale.status()).toBe(409)
  expect(await valueOf(page, p.id, "production", "API_KEY")).toBe("r3")
  await page.goto(`/secrets/${p.id}?view=requests&request=${r2}`)
  await expect(page.getByText(/Out of date/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Merge", exact: true })).toBeDisabled()

  // Temporary access: OTHER is limited to Development, asks for Production for an hour.
  expect((await page.request.patch(`${API}/projects/${p.id}/members/${otherId}`, { data: { role: "developer", envIds: [p.envs.development] } })).status()).toBe(200)
  expect((await other.request.get(`${API}/projects/${p.id}/secrets?env=production`)).status()).toBe(404)
  await other.goto(`/secrets/${p.id}?view=access-requests`)
  await other.getByRole("button", { name: "Request access" }).click()
  await other.getByLabel("Environment").selectOption({ label: "Production" })
  await other.getByLabel("Why do you need it?").fill("debugging the deploy")
  await other.getByRole("button", { name: "Send request" }).click()
  await expect(other.getByText("debugging the deploy")).toBeVisible()
  await page.goto(`/secrets/${p.id}?view=access-requests`)
  await page.getByRole("button", { name: "Approve" }).click()
  await expect(page.getByText(/until /)).toBeVisible()
  // Granted at once, read-only; a write is still refused.
  expect((await other.request.get(`${API}/projects/${p.id}/secrets?env=production`)).status()).toBe(200)
  expect((await other.request.post(`${API}/projects/${p.id}/secrets`, { data: { envId: prod, ops: [{ key: "NOPE", value: "1" }] } })).status()).toBe(403)
  await other.goto(`/secrets/${p.id}`)
  await expect(other.getByRole("status").filter({ hasText: "Temporary access" })).toBeVisible()
  // It runs out on its own: checked on every read, then the sweep tells them.
  db(`update secret_access_requests set expires_at = now() - interval '1 minute' where project_id = '${p.id}' and status = 'approved'`)
  expect((await other.request.get(`${API}/projects/${p.id}/secrets?env=production`)).status()).toBe(404)
  await sweep(page)
  const after = await (await other.request.get("/api/v1/notifications")).json()
  expect(JSON.stringify(after.items)).toContain("has expired")

  // The project's audit saw all of it, with where it came from.
  const log = await (await page.request.get(`${API}/projects/${p.id}/audit`)).json()
  const actions = new Set((log.rows as { action: string }[]).map((r) => r.action))
  for (const a of ["secrets_request", "secrets_review", "secrets_merge", "secrets_access_request", "secrets_access_decision"]) expect(actions.has(a)).toBe(true)
  expect(log.rows.every((r: { ip: string | null }) => r.ip !== undefined)).toBe(true)
  expect(log.rows.find((r: { action: string }) => r.action === "secrets_merge").ip).toBeTruthy()

  await ctx.close()
  await page.request.delete(`${API}/projects/${p.id}`)
})

test("org policies: idle cap, two-factor requirement, share links off and trash retention", async ({ page }) => {
  test.setTimeout(90_000)
  await page.waitForTimeout(10_500)
  await signIn(page)
  await unlock(page)
  const p = await seedProject(page)
  try {
    // Idle cap: members can't pick a longer lock than the admin allows.
    db("update settings set secret_max_idle_minutes = 5")
    const st = await (await page.request.get(`${API}/status`)).json()
    expect(st.lockChoices).toEqual([5])
    expect(st.lockMinutes).toBeLessThanOrEqual(5)
    db("update settings set secret_max_idle_minutes = null")

    // Share links off: creating one is refused, and an existing link stops opening.
    const made = await page.request.post(`${API}/shares`, { data: { text: "hello", minutes: 60, maxViews: 1 } })
    expect(made.status()).toBe(200)
    const token = (await made.json()).token as string
    expect((await page.request.get(`/api/secret-share/${token}`)).status()).toBe(200)
    db("update settings set secret_shares_enabled = false")
    expect((await page.request.post(`${API}/shares`, { data: { text: "hello", minutes: 60, maxViews: 1 } })).status()).toBe(403)
    expect((await (await page.request.get(`/api/secret-share/${token}`)).json()).ok).toBe(false)
    db("update settings set secret_shares_enabled = true")
    // A bad request is refused: expiry out of range, password-less reveal of a password link.
    expect((await page.request.post(`${API}/shares`, { data: { text: "x", minutes: 5, maxViews: 1 } })).status()).toBe(400)
    const locked = (await (await page.request.post(`${API}/shares`, { data: { text: "pw", minutes: 60, maxViews: 1, password: "s3cret-pass" } })).json()).token as string
    expect((await page.request.post(`/api/secret-share/${locked}`, { data: {} })).status()).toBe(403)
    const ok = await page.request.post(`/api/secret-share/${locked}`, { data: { password: "s3cret-pass" } })
    expect((await ok.json()).text).toBe("pw")

    // Trash retention: the sweep removes what's older than the admin's days.
    const id = await idOf(page, p.id, "development", "API_KEY")
    await page.request.post(`${API}/projects/${p.id}/secrets/bulk`, { data: { action: "delete", ids: [id] } })
    expect(db(`select count(*) from secrets where id = '${id}'`)).toBe("1")
    db(`update secrets set deleted_at = now() - interval '3 days' where id = '${id}'`)
    await sweep(page)
    expect(db(`select count(*) from secrets where id = '${id}'`)).toBe("1")
    db("update settings set secret_trash_days = 1")
    await sweep(page)
    expect(db(`select count(*) from secrets where id = '${id}'`)).toBe("0")

    // Time-based notices from the sweep: a rotation date that has come, a token that expires tomorrow.
    const live = await idOf(page, p.id, "production", "API_KEY")
    await page.request.post(`${API}/projects/${p.id}/secrets`, { data: { envId: p.envs.production, ops: [{ id: live, key: "API_KEY", rotationAt: "2020-01-01" }] } })
    const tok = await page.request.post(`${API}/projects/${p.id}/tokens`, { data: { name: "soon", envIds: [p.envs.development], expiresInDays: 1 } })
    expect(tok.status()).toBe(200)
    await sweep(page)
    const notes = JSON.stringify((await (await page.request.get("/api/v1/notifications")).json()).items)
    expect(notes).toContain("Time to rotate API_KEY")
    expect(notes).toContain("“soon”")
    expect(notes).toContain("expires in a day")

    // Two-factor required: a member without it is turned away by the API.
    db("update settings set secret_require_2fa = true")
    const r = await page.request.get(`${API}/projects`)
    expect(r.status()).toBe(403)
    expect((await r.json()).error).toBe("needs-2fa")
  } finally {
    db("update settings set secret_max_idle_minutes = null, secret_trash_days = null, secret_require_2fa = false, secret_shares_enabled = true")
  }
  await page.request.delete(`${API}/projects/${p.id}`)
})
