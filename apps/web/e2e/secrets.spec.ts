import { expect, request as pwRequest, test, type Page } from "@playwright/test"

import { createServer } from "node:http"
import { createHmac } from "node:crypto"

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
