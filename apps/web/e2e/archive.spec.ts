import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"

import { expect, test } from "@playwright/test"

import { signIn } from "./helpers"
import { startSite } from "./fixtures/archive-site.mjs"

// Website Archiver (/more/archive). Needs the dev app, `npm run worker` and a browser service:
//   docker run -d --rm --name nimbus-browser -p 127.0.0.1:3410:3000 -e TOKEN=nimbus-browser ghcr.io/browserless/chromium:v2.24.3
// (or `docker compose --profile browser up -d browser` with the port published). E2E_BROWSER_URL is its address as the
// APP sees it (default ws://127.0.0.1:3410?token=nimbus-browser). The browser opens the test site, so it must reach this
// machine: E2E_SITE_HOST is this machine as the browser sees it (default 172.17.0.1, the Docker bridge) and the app must
// resolve it too. Signs in as the dev admin, who is also a member. Everything it makes carries `tag` and is removed.
const EMAIL = process.env.E2E_ADMIN ?? "admin-test@example.invalid"
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "admin-test-pass-123"
const BROWSER = process.env.E2E_BROWSER_URL ?? "ws://127.0.0.1:3410?token=nimbus-browser"
const HOST = process.env.E2E_SITE_HOST ?? "172.17.0.1"
const PORT = Number(process.env.E2E_SITE_PORT ?? 3991)
const sql = (q: string) => execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()
const who = `(select id from "user" where email = '${EMAIL}')`
const tag = Date.now().toString(36)
const SITE = `http://${HOST}:${PORT}`
const hash = (s: string) => createHash("sha256").update(s.replace(/[\s-]/g, "").toLowerCase()).digest("hex")
const PW = `e2ea-${tag}-aaaaa-bbbbb-ccccc-ddddd`
const PW_RO = `e2eb-${tag}-aaaaa-bbbbb-ccccc-ddddd`
const basic = (pw: string) => `Basic ${Buffer.from(`${EMAIL}:${pw}`).toString("base64")}`

let site: Awaited<ReturnType<typeof startSite>>
let was: string

test.describe.configure({ mode: "serial" })

test.beforeAll(async () => {
  site = await startSite(PORT)
  was = sql(`select archiver_tool_enabled::text || '|' || coalesce(archiver_browser_url, '') from settings`)
  sql(`update settings set archiver_tool_enabled = true, archiver_browser_url = '${BROWSER.replace(/'/g, "''")}'`)
  sql(`insert into app_passwords (user_id, name, scope, hash, last_four) values (${who}, 'e2e rw ${tag}', 'rw', '${hash(PW)}', 'dddd'), (${who}, 'e2e ro ${tag}', 'ro', '${hash(PW_RO)}', 'dddd')`)
})

test.afterAll(async () => {
  await site.close()
  const [on, url] = was.split("|")
  sql(`update settings set archiver_tool_enabled = ${on}, archiver_browser_url = ${url ? `'${url.replace(/'/g, "''")}'` : "null"}`)
  sql(`delete from app_passwords where name like 'e2e % ${tag}'`)
  // Pages, then the files they made (the site folder named after the test host and any tagged ones).
  const ids = `select id from archive_pages where user_id = ${who} and '${tag}' = any(tags)`
  sql(`delete from nodes where id in (select unnest(array[html_node_id, pdf_node_id, png_node_id, text_node_id]) from archive_snapshots where page_id in (${ids}))`)
  sql(`delete from archive_pages where id in (${ids})`)
})

const snapshots = (url: string) => Number(sql(`select count(*) from archive_snapshots s join archive_pages p on p.id = s.page_id where p.user_id = ${who} and p.url = '${url}'`))
const status = (url: string) => sql(`select last_status from archive_pages where user_id = ${who} and url = '${url}'`)

test("paste, capture all four files, unchanged recapture adds nothing, a change adds a version", async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page, EMAIL, PASS)
  await page.goto("/more/archive")
  await expect(page.getByRole("heading", { name: "Website archive" })).toBeVisible()

  await test.step("paste an address and capture it", async () => {
    await page.getByLabel("Addresses, one per line").fill(`${SITE}/\nnot-a-url\n`)
    await page.getByLabel("Tags (optional)").fill(tag)
    await page.getByRole("button", { name: "Save and capture" }).click()
    await expect(page.getByText(/1 saved.*1 skipped/)).toBeVisible()
    await expect.poll(() => snapshots(`${SITE}/`), { timeout: 120_000, intervals: [2000] }).toBe(1)
    await expect.poll(() => status(`${SITE}/`)).toBe("ok")
  })

  const row = () => sql(`select concat_ws('|', h.name, p.name, g.name, t.name, h.mime, p.mime, g.mime, t.mime, p.size > 1000, g.size > 100) from archive_snapshots s join archive_pages a on a.id = s.page_id
    join nodes h on h.id = s.html_node_id join nodes p on p.id = s.pdf_node_id join nodes g on g.id = s.png_node_id join nodes t on t.id = s.text_node_id where a.url = '${SITE}/' and a.user_id = ${who}`)
  await test.step("four files, in <folder>/<site>/<title> (<date>).<ext>", async () => {
    const parts = row().split("|")
    expect(parts[0]).toMatch(/^Archive fixture.* \(\d{4}-\d{2}-\d{2} \d{4}\)\.html$/)
    expect(parts[1]).toMatch(/\.pdf$/)
    expect(parts[2]).toMatch(/\.png$/)
    expect(parts[3]).toMatch(/\.md$/)
    expect(parts.slice(4, 8)).toEqual(["text/html", "application/pdf", "image/png", "text/markdown"])
    expect(parts.slice(8)).toEqual(["t", "t"])
    expect(sql(`select count(*) from nodes f join nodes d on d.id = f.parent_id join nodes r on r.id = d.parent_id where f.id = (select html_node_id from archive_snapshots s join archive_pages a on a.id = s.page_id where a.url = '${SITE}/' and a.user_id = ${who}) and d.name = '${HOST}' and r.name = 'Web archive'`)).toBe("1")
  })

  await test.step("the HTML is one self-contained file: styles and image inline, scripts gone", async () => {
    const id = sql(`select html_node_id from archive_snapshots s join archive_pages a on a.id = s.page_id where a.url = '${SITE}/' and a.user_id = ${who}`)
    const r = await page.request.get(`/api/archive/file/${id}`)
    expect(r.ok()).toBeTruthy()
    const html = await r.text()
    expect(html).toContain("data:image/png;base64")
    expect(html).toContain("background:#fffbe6")
    expect(html).not.toContain("/style.css")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("onclick")
    // What the script drew is kept as plain content.
    expect(html).toContain("SCRIPT RAN")
    expect(html).toContain("This is version 1")
  })

  const id = () => sql(`select id from archive_pages where user_id = ${who} and url = '${SITE}/'`)
  await test.step("the viewer: sandboxed iframe shows it, tabs, timeline", async () => {
    await page.goto(`/more/archive/${id()}`)
    await expect(page.getByRole("heading", { name: /Archive fixture/ })).toBeVisible()
    const frame = page.locator('iframe[title="Saved page"]')
    expect(await frame.getAttribute("sandbox")).toBe("")
    await expect(page.frameLocator('iframe[title="Saved page"]').getByRole("heading", { name: "Archive fixture" })).toBeVisible()
    await expect(page.frameLocator('iframe[title="Saved page"]').locator("#ran")).toHaveText("SCRIPT RAN")
    await page.getByRole("tab", { name: "Screenshot" }).click()
    await expect(page.getByRole("img", { name: /Screenshot of/ })).toBeVisible()
    await page.getByRole("tab", { name: "PDF" }).click()
    await expect(page.locator('iframe[title="PDF copy"]')).toBeVisible()
    await page.getByRole("tab", { name: "Text" }).click()
    await expect(page.locator('iframe[title="Page text"]')).toBeVisible()
    await expect(page.getByRole("listitem").filter({ hasText: "Latest" })).toHaveCount(1)
  })

  await test.step("recapture unchanged: recorded as unchanged, no new snapshot", async () => {
    await page.getByRole("button", { name: "Capture again" }).click()
    await expect.poll(() => status(`${SITE}/`), { timeout: 120_000, intervals: [2000] }).toBe("unchanged")
    expect(snapshots(`${SITE}/`)).toBe(1)
  })

  await test.step("change the site: recapture keeps a second version", async () => {
    site.state.version = 2
    await page.reload()
    await page.getByRole("button", { name: "Capture again" }).click()
    await expect.poll(() => snapshots(`${SITE}/`), { timeout: 120_000, intervals: [2000] }).toBe(2)
    await expect.poll(() => status(`${SITE}/`)).toBe("ok")
    await page.reload()
    await expect(page.getByRole("listitem").filter({ hasText: "Latest" })).toHaveCount(1)
    await expect(page.locator("ol li")).toHaveCount(2)
    await page.screenshot({ path: `${process.env.SHOTS ?? "/tmp"}/archive-viewer.png`, fullPage: true })
  })

  await test.step("schedule daily, then back to never", async () => {
    await page.getByLabel("Capture again automatically").selectOption("1440")
    await expect.poll(() => sql(`select interval_min from archive_pages where id = '${id()}'`)).toBe("1440")
    expect(sql(`select next_due_at is not null from archive_pages where id = '${id()}'`)).toBe("t")
    await page.getByLabel("Capture again automatically").selectOption("")
    await expect.poll(() => sql(`select next_due_at is null from archive_pages where id = '${id()}'`)).toBe("t")
  })

  await test.step("library: card, search, filters", async () => {
    await page.goto("/more/archive")
    await expect(page.getByRole("link", { name: /Archive fixture/ })).toBeVisible()
    await page.getByLabel("Search saved pages").fill("zzz-nothing")
    await expect(page.getByText("Nothing matches")).toBeVisible()
    await page.getByLabel("Search saved pages").fill("fixture")
    await expect(page.getByRole("link", { name: /Archive fixture/ })).toBeVisible()
    await page.getByLabel("Filter by tag").selectOption(tag)
    await page.getByRole("button", { name: "List" }).click()
    await expect(page.getByRole("link", { name: /Archive fixture/ })).toBeVisible()
    for (const w of [1280, 375]) {
      await page.setViewportSize({ width: w, height: 800 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `${process.env.SHOTS ?? "/tmp"}/archive-library-${w}.png`, fullPage: true })
    }
  })
})

test("a page that fails says why, and two failures in a row ring the bell", async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page, EMAIL, PASS)
  const url = `${SITE}/missing`
  await page.goto("/more/archive")
  await page.getByLabel("Addresses, one per line").fill(url)
  await page.getByLabel("Tags (optional)").fill(tag)
  await page.getByRole("button", { name: "Save and capture" }).click()
  await expect.poll(() => status(url), { timeout: 120_000, intervals: [2000] }).toBe("failed")
  expect(sql(`select last_error from archive_pages where user_id = ${who} and url = '${url}'`)).toMatch(/404/)
  const id = sql(`select id from archive_pages where user_id = ${who} and url = '${url}'`)
  await page.goto(`/more/archive/${id}`)
  await expect(page.getByText(/The last capture failed/)).toBeVisible()
  await page.getByRole("button", { name: "Capture again" }).click()
  await expect.poll(() => sql(`select fail_streak from archive_pages where id = '${id}'`), { timeout: 120_000, intervals: [2000] }).toBe("2")
  await expect.poll(() => sql(`select count(*) from notifications where user_id = ${who} and kind = 'archive_failed' and data->>'id' = '${id}'`)).toBe("1")
})

test("app password API: sign in, validate, add, repeat, read-only refused", async ({ request }) => {
  const url = `${SITE}/other`
  const post = (auth: string | null, body: unknown) => request.post("/api/v1/archive", { headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" }, data: body })
  expect((await post(null, { url })).status()).toBe(401)
  expect((await post(basic("wrong-wrong"), { url })).status()).toBe(401)
  expect((await post(basic(PW_RO), { url })).status()).toBe(403)
  expect((await post(basic(PW), { url: "javascript:alert(1)" })).status()).toBe(400)
  expect((await post(basic(PW), { nope: 1 })).status()).toBe(400)
  const first = await post(basic(PW), { url, tags: [tag, "from-api"] })
  expect(first.status()).toBe(201)
  expect(await first.json()).toMatchObject({ added: true })
  const again = await post(basic(PW), { url })
  expect(again.status()).toBe(200)
  expect(await again.json()).toMatchObject({ added: false })
  expect(sql(`select tags::text from archive_pages where user_id = ${who} and url = '${url}'`)).toContain("from-api")
})

test("bookmarks import keeps folders and TAGS as tags; the bookmarklet page confirms before saving", async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page, EMAIL, PASS)
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Bookmarks bar</H3><DL><p>
    <DT><H3>Reading</H3><DL><p><DT><A HREF="${SITE}/b1" TAGS="e2e-a">First</A></DL><p>
    <DT><A HREF="${SITE}/b2">Second</A><DT><A HREF="javascript:void(0)">skip</A></DL><p></DL>`
  await page.goto("/more/archive")
  await page.getByRole("tab", { name: "Import bookmarks" }).click()
  await page.getByLabel("Extra tags (optional)").fill(tag)
  await page.locator("#archive-file").setInputFiles({ name: "bookmarks.html", mimeType: "text/html", buffer: Buffer.from(html) })
  await page.getByRole("button", { name: "Import", exact: true }).click()
  await expect(page.getByText(/2 saved/)).toBeVisible()
  expect(sql(`select tags::text from archive_pages where user_id = ${who} and url = '${SITE}/b1'`)).toMatch(/e2e-a.*reading|reading.*e2e-a/)
  expect(sql(`select tags::text from archive_pages where user_id = ${who} and url = '${SITE}/b2'`)).not.toContain("reading")

  await page.getByRole("tab", { name: "Bookmarklet" }).click()
  expect(await page.getByRole("link", { name: "Save to Nimbus" }).getAttribute("href")).toMatch(/^javascript:location='.*\/more\/archive\/add\?url='\+encodeURIComponent\(location\.href\)$/)

  // The bookmarklet's landing page asks first.
  const target = `${SITE}/b3`
  await page.goto(`/more/archive/add?url=${encodeURIComponent(target)}`)
  await expect(page.getByText(target)).toBeVisible()
  expect(sql(`select count(*) from archive_pages where user_id = ${who} and url = '${target}'`)).toBe("0")
  await page.getByLabel("Tags (optional)").fill(tag)
  await page.getByRole("button", { name: "Save and capture" }).click()
  await expect(page.getByText(/Saved\. It is being captured now/)).toBeVisible()
  expect(sql(`select count(*) from archive_pages where user_id = ${who} and url = '${target}'`)).toBe("1")
  await page.goto("/more/archive/add?url=javascript:alert(1)")
  await expect(page.getByText(/isn.t a web address/)).toBeVisible()
  // Let the captures finish so the cleanup doesn't race a running job.
  await expect.poll(() => sql(`select count(*) from archive_pages where user_id = ${who} and last_status = 'running' and '${tag}' = any(tags)`), { timeout: 120_000, intervals: [2000] }).toBe("0")
})

test("settings: cookies are sealed and validated", async ({ page }) => {
  await signIn(page, EMAIL, PASS)
  await page.goto("/more/archive?tab=settings")
  await page.getByLabel("Site", { exact: true }).fill("Example.COM")
  await page.getByLabel("Cookie header").fill("session=secret-value-123; theme=dark")
  await page.getByRole("button", { name: "Save cookies" }).click()
  await expect(page.getByText("example.com", { exact: true })).toBeVisible()
  const sealed = sql(`select value_enc from archive_cookies where user_id = ${who} and domain = 'example.com'`)
  expect(sealed).not.toContain("secret-value-123")
  expect(sealed.length).toBeGreaterThan(20)
  await page.getByRole("button", { name: "Delete the cookies for example.com" }).click()
  await expect.poll(() => sql(`select count(*) from archive_cookies where user_id = ${who} and domain = 'example.com'`)).toBe("0")
  await page.getByLabel("Site", { exact: true }).fill("not a domain")
  await page.getByLabel("Cookie header").fill("a=b")
  await page.getByRole("button", { name: "Save cookies" }).click()
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText("site like example.com")
})

test("no browser service: the page and the card say so; tool off: 404", async ({ page, request }) => {
  await signIn(page, EMAIL, PASS)
  sql(`update settings set archiver_browser_url = null`)
  await page.goto("/more/archive")
  await expect(page.getByRole("heading", { name: "Needs the browser service" })).toBeVisible()
  await expect(page.getByText("docker compose --profile browser up -d browser")).toBeVisible()
  await expect(page.getByRole("button", { name: "Save and capture" })).toBeDisabled()
  await page.goto("/more")
  await expect(page.getByRole("link", { name: /Website archive/ })).toContainText("Needs the browser service")
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto("/more/archive")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `${process.env.SHOTS ?? "/tmp"}/archive-needs-browser-375.png`, fullPage: true })

  sql(`update settings set archiver_browser_url = '${BROWSER.replace(/'/g, "''")}', archiver_tool_enabled = false`)
  const gone = await page.goto("/more/archive")
  expect(gone?.status()).toBe(404)
  expect((await page.goto("/more/archive/add?url=https://example.com"))?.status()).toBe(404)
  await page.goto("/more")
  await expect(page.getByRole("link", { name: /Website archive/ })).toHaveCount(0)
  const r = await request.post("/api/v1/archive", { headers: { authorization: basic(PW), "content-type": "application/json" }, data: { url: `${SITE}/off` } })
  expect(r.status()).toBe(404)
  sql(`update settings set archiver_tool_enabled = true`)
})
