import { expect, test, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"

import { ME, OTHER, PASSWORD, signIn, unique } from "./helpers"

// Needs SECRETS_ROOT_KEY, Secrets on. The WebDAV test also needs `npm run webdav` (E2E_DAV=1,
// proxy on :3404) and the worker, which scans the file.
const API = "/api/v1/secrets"
const db = (q: string) =>
  execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()

async function unlock(page: Page) {
  await page.goto("/secrets")
  await page.getByLabel("Your Nimbus password").fill(PASSWORD)
  await page.getByRole("button", { name: "Unlock", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible()
}

test("domain watch: a developer can't add one", async ({ page, browser, baseURL }) => {
  await signIn(page)
  await unlock(page)
  const p = await (await page.request.post(`${API}/projects`, { data: { name: unique("watchrole") } })).json()
  try {
    expect((await page.request.post(`${API}/projects/${p.id}/members`, { data: { email: OTHER, role: "developer", envIds: null } })).status()).toBe(200)
    const ctx = await browser.newContext({ baseURL })
    const other = await ctx.newPage()
    await other.waitForTimeout(10_500) // sign-in allows 3 tries per 10 seconds
    await signIn(other, OTHER)
    await unlock(other)
    expect((await other.request.post(`${API}/projects/${p.id}/watches`, { data: { host: "example.com", port: 443 } })).status()).toBe(403)
    await ctx.close()
  } finally {
    await page.request.delete(`${API}/projects/${p.id}`)
  }
})

test("a WebDAV upload is checked for leaked keys", async ({ page }) => {
  test.skip(!process.env.E2E_DAV, "needs npm run webdav and the worker (E2E_DAV=1)")
  await signIn(page)
  db("update settings set secret_leak_scan = true")
  const pw = (await (await page.request.post("/api/v1/account/app-passwords", { data: { name: unique("dav"), scope: "rw" } })).json()).password as string
  const rand = (a: string, n: number) => Array.from({ length: n }, () => a[Math.floor(Math.random() * a.length)]).join("")
  const name = `dav-leak-${Date.now().toString(36)}.env`
  const put = await fetch(`http://localhost:3404/dav/${name}`, {
    method: "PUT",
    headers: { authorization: "Basic " + Buffer.from(`${ME}:${pw}`).toString("base64") },
    body: `AWS_ACCESS_KEY_ID=AKIA${rand("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", 16)}\nNAME=nimbus\n`,
  })
  expect(put.status).toBe(201)
  const q = `select count(*) from secret_leaks l join nodes n on n.id=l.node_id where n.name='${name}'`
  try {
    await expect.poll(() => db(q), { timeout: 60_000 }).toBe("1")
  } finally {
    // An open finding would skew the health score other specs count.
    db(`delete from nodes where name='${name}'`)
  }
})
