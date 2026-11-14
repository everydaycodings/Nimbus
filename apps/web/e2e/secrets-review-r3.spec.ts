import { expect, test, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"

import { PASSWORD, signIn, unique } from "./helpers"

// Review R3: save speed on a big project, the per-project limit, reference blowups, and
// the Save bar keeping what you type. Needs SECRETS_ROOT_KEY and Secrets on.
const API = "/api/v1/secrets"
const db = (q: string) =>
  execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()

async function unlock(page: Page) {
  await page.goto("/secrets")
  await page.getByLabel("Your Nimbus password").fill(PASSWORD)
  await page.getByRole("button", { name: "Unlock", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible()
}

async function seed(page: Page, name: string, extraEnvs: string[] = []) {
  const made = await (await page.request.post(`${API}/projects`, { data: { name: unique(name) } })).json()
  for (const e of extraEnvs) await page.request.post(`${API}/projects/${made.id}/envs`, { data: { name: e } })
  const detail = await (await page.request.get(`${API}/projects/${made.id}`)).json()
  return { id: made.id as string, envs: Object.fromEntries(detail.envs.map((e: { slug: string; id: string }) => [e.slug, e.id])) as Record<string, string> }
}
const save = (page: Page, id: string, envId: string, ops: object[]) => page.request.post(`${API}/projects/${id}/secrets`, { data: { envId, ops } })

test("a save in a 10,000-secret project stays quick; the limit counts a save's own rows once", async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page)
  await unlock(page)
  const p = await seed(page, "big", ["QA", "Perf"])
  const slugs = Object.keys(p.envs)
  expect(slugs).toHaveLength(5)
  for (const [n, slug] of slugs.entries()) {
    // Every 50th key references production, so the dependents graph has edges.
    const items = Array.from({ length: 2000 }, (_, i) => ({ key: `K${i}`, value: i % 50 === 0 && slug !== "production" ? `\${production.K${i}}` : `v${n}-${i}-${"x".repeat(40)}` }))
    const r = await page.request.post(`${API}/projects/${p.id}/secrets/import`, { data: { mode: "apply", envId: p.envs[slug], folderId: null, items } })
    expect(r.status(), await r.text()).toBe(200)
  }
  const times: number[] = []
  for (let i = 0; i < 7; i++) {
    const t = Date.now()
    expect((await save(page, p.id, p.envs.production, [{ key: `NEW_${i}`, value: "x" }])).status()).toBe(200)
    times.push(Date.now() - t)
  }
  const median = times.sort((a, b) => a - b)[3]
  console.log(`R3 save in a 10,000-secret project: median ${median} ms (${times.join(", ")})`)
  expect(median).toBeLessThan(1500)
  const t = Date.now()
  const list = (await (await page.request.get(`${API}/projects/${p.id}/secrets?env=development`)).json()).secrets as { id: string; key: string }[]
  expect((await page.request.post(`${API}/projects/${p.id}/secrets/reveal`, { data: { ids: [list.find((s) => s.key === "K0")!.id] } })).status()).toBe(200)
  console.log(`R3 list + reveal one: ${Date.now() - t} ms`)

  // With a limit of 10, one save of 10 new secrets fits (it used to count its own rows twice).
  const before = db("select coalesce(max_secrets_per_project::text, '') from settings")
  const small = await seed(page, "limit")
  db("update settings set max_secrets_per_project = 10")
  try {
    const r = await save(page, small.id, small.envs.development, Array.from({ length: 10 }, (_, i) => ({ key: `L${i}`, value: "1" })))
    expect(r.status(), await r.text()).toBe(200)
    expect((await r.json()).created).toHaveLength(10)
    const over = await save(page, small.id, small.envs.development, [{ key: "L10", value: "1" }])
    expect(over.status()).toBe(422)
    // Copying into another environment can't step past it either.
    const ids = ((await (await page.request.get(`${API}/projects/${small.id}/secrets?env=development`)).json()).secrets as { id: string }[]).map((s) => s.id)
    const copy = await page.request.post(`${API}/projects/${small.id}/secrets/bulk`, { data: { action: "copy", ids, toEnvId: small.envs.staging } })
    expect(copy.status()).toBe(422)
  } finally {
    db(`update settings set max_secrets_per_project = ${before === "" ? "null" : before}`)
  }
  await page.request.delete(`${API}/projects/${p.id}`)
  await page.request.delete(`${API}/projects/${small.id}`)
})

test("a doubling reference chain is refused quickly, and a value over 100,000 characters too", async ({ page }) => {
  await signIn(page)
  await unlock(page)
  const p = await seed(page, "blowup")
  const ops = [{ key: "A30", value: "x".repeat(100) }, ...Array.from({ length: 30 }, (_, i) => ({ key: `A${i}`, value: `\${A${i + 1}}\${A${i + 1}}` }))]
  const t = Date.now()
  const r = await save(page, p.id, p.envs.development, ops)
  expect(Date.now() - t).toBeLessThan(5000)
  expect(r.status()).toBe(422)
  expect(await r.text()).toMatch(/expand to more than 256 KB/)
  // The token API's writes have no route cap of their own: the service refuses.
  const tok = (await (await page.request.post(`${API}/projects/${p.id}/tokens`, { data: { name: "r3 rw", envIds: [p.envs.development], access: "rw" } })).json()).token as string
  const big = await page.request.post(`${API}/secrets`, {
    headers: { authorization: `Bearer ${tok}` },
    data: { env: "development", set: { BIG: "y".repeat(100_001) } },
  })
  expect(big.status(), await big.text()).toBe(422)
  const fits = await page.request.post(`${API}/secrets`, { headers: { authorization: `Bearer ${tok}` }, data: { env: "development", set: { BIG: "y".repeat(100_000) } } })
  expect(fits.status(), await fits.text()).toBe(200)
  await page.request.delete(`${API}/projects/${p.id}`)
})

test("the Save bar locks the rows while saving, and an override keeps unsaved edits", async ({ page }) => {
  await signIn(page)
  await unlock(page)
  const p = await seed(page, "savebar")
  expect((await save(page, p.id, p.envs.development, [{ key: "ONE", value: "1" }, { key: "TWO", value: "2" }])).status()).toBe(200)
  await page.goto(`/secrets/${p.id}?view=development`)
  await expect(page.getByLabel("Key of ONE")).toBeVisible()

  // Unsaved: a new comment on ONE. Then an override on TWO: the comment edit survives.
  await page.getByRole("button", { name: "Details for ONE" }).click()
  await page.getByPlaceholder("What this is for").fill("kept")
  await expect(page.getByText("1 unsaved change")).toBeVisible()
  await page.getByRole("button", { name: "Details for ONE" }).click()
  await page.getByRole("button", { name: "Details for TWO" }).click()
  await page.getByPlaceholder("Set your override").fill("mine")
  await page.getByRole("button", { name: "Save mine" }).click()
  await expect(page.getByText("Saved your own value.")).toBeVisible()
  await expect(page.getByText("1 unsaved change")).toBeVisible()

  // While the save is in flight, the rows can't be edited.
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  await page.route(`**${API}/projects/${p.id}/secrets`, async (route) => {
    if (route.request().method() === "POST") await held
    await route.continue()
  })
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByLabel("Key of ONE")).toBeDisabled()
  release()
  await expect(page.getByText("unsaved change")).toBeHidden()
  await expect(page.getByLabel("Key of ONE")).toBeEnabled()
  await page.unroute(`**${API}/projects/${p.id}/secrets`)
  await page.request.delete(`${API}/projects/${p.id}`)
})
