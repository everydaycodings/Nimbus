import { expect, test, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { signIn } from "./helpers"

// Git Backup against the fake GitHub (node e2e/fixtures/fake-github.mjs <dir> 3990, app started with
// GITHUB_API_URL=http://localhost:3990, worker running). Signs in as the dev admin, which is also a member.
// Leaves the fake's revoke switch off. SHOTS=dir for screenshots (default /tmp).
const FAKE = process.env.FAKE_GITHUB ?? "http://localhost:3990"
const EMAIL = process.env.E2E_ADMIN ?? "admin-test@example.invalid"
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "admin-test-pass-123"
const SHOTS = process.env.SHOTS ?? "/tmp"
const sql = (q: string) => execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()
const tag = Date.now().toString(36)
const BASE = "/more/github-backup"
let n = 3

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true })
  for (const w of [1440, 375]) {
    await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 812 })
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(SHOTS, `git-backup-${name}-${w}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1280, height: 720 })
}

// Reload until the check passes: runs finish in the worker, so the page has to be asked again.
const settle = (page: Page, check: () => Promise<void>, timeout = 120_000) =>
  expect(async () => {
    await page.reload()
    await check()
  }).toPass({ timeout, intervals: [2000] })

const jobId = (page: Page) => new URL(page.url()).searchParams.get("job")!

async function newBucket(page: Page, name: string) {
  const make = page.getByRole("radio", { name: "Make a new bucket" })
  // Wait for the bucket list: the radio only shows when there are buckets.
  await make.or(page.getByLabel("New bucket name")).first().waitFor()
  if (await make.isVisible().catch(() => false)) await make.check()
  await page.getByLabel("New bucket name").fill(name)
}

async function backUpNow(page: Page) {
  await page.goto(`${BASE}?job=${jobId(page)}`)
  const btn = page.getByRole("button", { name: "Back up now" })
  await expect(btn).toBeEnabled({ timeout: 60_000 })
  await btn.click()
  await expect(page.getByText("Backup started")).toBeVisible()
}

test.describe.configure({ mode: "serial" })

test("git backup: connect, back up, change, everything scope, browse", async ({ page }) => {
  test.setTimeout(420_000)

  await test.step("start clean", async () => {
    const who = `(select id from "user" where email = '${EMAIL}')`
    sql(`delete from git_backup_jobs where user_id = ${who}; delete from git_backup_connections where user_id = ${who}`)
    await signIn(page, EMAIL, PASS)
    await page.goto(BASE)
  })

  await test.step("wizard: token, Secrets dialog, new bucket, choose all repos", async () => {
    await expect(page.getByRole("heading", { name: "Git Backup", level: 1 })).toBeVisible()
    await expect(page.getByText("Set up Git Backup")).toHaveCount(0)
    await page.getByLabel("Token", { exact: true }).fill("ghp_faketoken")
    await page.getByLabel("Name (optional)").fill(`e2e-${tag}`)
    await page.getByRole("button", { name: "Check and save" }).click()
    await expect(page.getByRole("dialog", { name: "Keep a copy in Secrets?" })).toBeVisible()
    await page.getByRole("button", { name: "Not now" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Signed in as octo" })).toContainText("repo, read:org")
    await shot(page, "wizard-connect")
    await page.getByRole("button", { name: "Next", exact: true }).click()

    await newBucket(page, `gb-${tag}-a`)
    await page.getByRole("button", { name: "Next", exact: true }).click()

    // Scope: the three bordered cards, "Choose repos" first selected.
    await expect(page.getByRole("radiogroup", { name: "What to back up" })).toBeVisible()
    await expect(page.getByRole("radio", { name: /Choose repos/ })).toBeChecked()
    await page.getByLabel(/Select all \d+ shown/).check()
    // The fake keeps repos that earlier runs added, so count what it shows.
    await expect(page.getByText(/^\d+ selected$/)).toBeVisible()
    n = Number((await page.getByText(/^\d+ selected$/).textContent())!.split(" ")[0])
    expect(n).toBeGreaterThanOrEqual(3)
    await expect(page.getByText("Also add new repos from…")).toBeVisible()
    await shot(page, "wizard-scope")
    await page.getByRole("button", { name: "Next", exact: true }).click()

    await page.getByLabel("Job name").fill(`Job ${tag}`)
    await page.getByRole("button", { name: "Create and back up" }).click()
    await expect(page).toHaveURL(/job=/)
  })

  await test.step("tabs are tabs, and every chosen repo gets backed up", async () => {
    const id = jobId(page)
    await expect(page.getByRole("tablist", { name: "Git Backup sections" })).toBeVisible()
    await page.getByRole("tab", { name: "Repos" }).click()
    await expect(page).toHaveURL(new RegExp(`tab=repos`))
    await expect(page.getByText("Backing up the repos you chose.")).toBeVisible()
    await settle(page, async () => {
      await expect(page.getByText("Backed up", { exact: true })).toHaveCount(n)
      // The snapshot count reads the real number, not 0.
      await expect(page.getByText(/· 1 snapshot ·/)).toHaveCount(n)
    })
    await shot(page, "repos")
    expect(id).toBeTruthy()
  })

  await test.step("back up now: nothing changed", async () => {
    await backUpNow(page)
    await page.goto(`${BASE}?job=${jobId(page)}&tab=history`)
    await settle(page, () => expect(page.getByRole("button", { name: /Manual/ }).first()).toContainText(`${n} checked · 0 changed`))
  })

  await test.step("a push is one change", async () => {
    const r = await page.request.post(`${FAKE}/_test/push/octo/hello`)
    expect(r.ok()).toBeTruthy()
    await backUpNow(page)
    await page.goto(`${BASE}?job=${jobId(page)}&tab=history`)
    await settle(page, () => expect(page.getByRole("button", { name: /Manual/ }).first()).toContainText(`${n} checked · 1 changed`))
    await shot(page, "history")
  })

  await test.step("browse a snapshot", async () => {
    await page.getByLabel("Repo", { exact: true }).selectOption({ label: "octo/hello" })
    await page.getByRole("button", { name: /^More for the snapshot/ }).first().click()
    await page.getByRole("menuitem", { name: "Browse files" }).click()
    await expect(page.getByRole("button", { name: "log.txt" })).toBeVisible()
    await page.getByRole("button", { name: "log.txt" }).click()
    await expect(page.locator("pre")).toBeVisible()
  })

  await test.step("settings show the scope choice", async () => {
    await page.goto(`${BASE}?job=${jobId(page)}&tab=settings`)
    await expect(page.getByRole("radiogroup", { name: "What to back up" })).toBeVisible()
    await shot(page, "settings")
    // "Choose repos" plus new ones from acme stays that choice and doesn't pull in acme's existing repos (old-site).
    await page.getByRole("switch", { name: "New repos from acme" }).check()
    await page.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Saved." }).first()).toBeVisible()
    await page.reload()
    await expect(page.getByRole("radio", { name: /Choose repos/ })).toBeChecked()
    await expect(page.getByRole("switch", { name: "New repos from acme" })).toBeChecked()
    await backUpNow(page)
    await page.goto(`${BASE}?job=${jobId(page)}&tab=repos`)
    await expect(page.getByText("Backing up the repos you chose, plus new ones from acme.")).toBeVisible()
    await expect(page.getByText(`${n} in this job.`, { exact: false })).toBeVisible()
  })

  await test.step("second job: everything this token can see", async () => {
    await page.goto(`${BASE}?new=1`)
    await page.getByRole("radio", { name: new RegExp(`e2e-${tag}`) }).check()
    await expect(page.getByRole("status").filter({ hasText: "Signed in as octo" })).toBeVisible()
    await page.getByRole("button", { name: "Next", exact: true }).click()
    await newBucket(page, `gb-${tag}-b`)
    await page.getByRole("button", { name: "Next", exact: true }).click()
    await page.getByRole("radio", { name: /Everything this token can see/ }).check()
    await expect(page.getByText(/archived repo never changes/)).toBeVisible()
    await shot(page, "wizard-everything")
    await page.getByRole("button", { name: "Next", exact: true }).click()
    await expect(page.getByText("Everything this token can see, new repos included.")).toBeVisible()
    await page.getByLabel("Job name").fill(`All ${tag}`)
    await page.getByLabel("Folder in the bucket").fill("git-backup-all")
    await page.getByRole("button", { name: "Create and back up" }).click()
    await expect(page).toHaveURL(/job=/)

    await page.goto(`${BASE}?job=${jobId(page)}&tab=repos`)
    await expect(page.getByText("Backing up everything octo can see, new repos included.")).toBeVisible()
    // Forks and archived repos are in, from the start.
    await expect(page.getByText("octo/forked-lib")).toBeVisible()
    await expect(page.getByText("acme/old-site")).toBeVisible()
    await settle(page, async () => {
      await expect(page.getByText("Waiting", { exact: true })).toHaveCount(0)
      await expect(page.getByText("Backed up", { exact: true }).nth(4)).toBeVisible()
    })
  })

  const added = `newrepo-${tag}`
  await test.step("a new repo joins on the next run", async () => {
    const r = await page.request.get(`${FAKE}/_test/add?name=${added}`, { headers: { authorization: "Bearer ghp_faketoken" } })
    expect(r.ok()).toBeTruthy()
    await backUpNow(page)
    await page.goto(`${BASE}?job=${jobId(page)}&tab=repos`)
    await settle(page, async () => {
      await expect(page.getByText(`acme/${added}`)).toBeVisible()
      await expect(page.getByText("Backed up", { exact: true }).last()).toBeVisible()
    })
  })

  await test.step("removing a repo asks first", async () => {
    await page.getByRole("button", { name: `Actions for acme/${added}` }).click()
    await page.getByRole("menuitem", { name: "Remove from job" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toContainText(`acme/${added}`)
    await dialog.getByRole("button", { name: "Keep" }).click()
    await expect(page.getByText(`acme/${added}`)).toBeVisible()
    await page.getByRole("button", { name: `Actions for acme/${added}` }).click()
    await page.getByRole("menuitem", { name: "Remove from job" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Remove from job" }).click()
    await expect(page.getByText(`acme/${added}`)).toHaveCount(0)
  })

  await test.step("the More card shows the status line", async () => {
    await page.goto("/more")
    await expect(page.getByRole("link", { name: /Git Backup/ })).toContainText(/Last backup .* · \d+ repos/)
    await shot(page, "more")
  })

  await test.step("admin pages render", async () => {
    await page.goto("/admin/system/more-tools")
    await expect(page.getByRole("heading", { name: "More tools" }).first()).toBeVisible()
    await page.getByRole("link", { name: /every member.s backup jobs/ }).click()
    await expect(page.getByRole("heading", { name: "Git Backup jobs" })).toBeVisible()
    await expect(page.getByText(`Job ${tag}`)).toBeVisible()
    await shot(page, "admin-jobs")
  })
})
