import { expect, test, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { signIn } from "./helpers"

// Token permission checks (Check and save, Replace token, Check permissions on a saved token). Needs the fake GitHub on :3990
// (the app started with GITHUB_API_URL=http://localhost:3990), the fake GitLab on :3992 and the worker not required. The fakes read the
// token string: "norepo", "noorg", "nohook", "fine" (GitHub), "norepo", "apionly" (GitLab). The Gitea and Forgejo test needs docker (git-hosts.sh).
const EMAIL = process.env.E2E_ADMIN ?? "admin-test@example.invalid"
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "admin-test-pass-123"
const sql = (q: string) => execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()
const tag = Date.now().toString(36)
const BASE = "/more/github-backup"
const who = `(select id from "user" where email = '${EMAIL}')`
const HOSTS_OUT = process.env.GIT_HOSTS_OUT ?? join(tmpdir(), "nimbus-git-hosts")
const BASIC = `Basic ${Buffer.from("octo:e2e-pass-12345").toString("base64")}`
const saved = { allowPrivate: "f" }
const count = (name: string) => Number(sql(`select count(*) from git_backup_connections where user_id = ${who} and name = '${name}'`))

test.describe.configure({ mode: "serial" })

test.beforeAll(() => {
  saved.allowPrivate = sql("select secret_allow_private from settings")
  sql("update settings set secret_allow_private = true")
})
test.afterAll(() => {
  sql(`delete from git_backup_jobs where user_id = ${who} and name like '%${tag}'; delete from git_backup_connections where user_id = ${who} and name like 'perm-${tag}%'`)
  sql(`update settings set secret_allow_private = ${saved.allowPrivate === "t"}`)
})

// The connect form, open with a provider chosen.
async function openForm(page: Page, provider: "GitHub" | "GitLab" | "Gitea" | "Forgejo") {
  await page.goto(`${BASE}?new=1`)
  const add = page.getByRole("button", { name: "Add a token" })
  if (await add.isVisible().catch(() => false)) await add.click()
  await page.getByRole("radio", { name: new RegExp(provider) }).check()
}
async function submit(page: Page, token: string, name: string, server?: string) {
  if (server) await page.getByLabel("Server URL", { exact: false }).fill(server)
  await page.getByLabel("Token", { exact: true }).fill(token)
  await page.getByLabel("Name (optional)").fill(name)
  await page.getByRole("button", { name: "Check and save" }).click()
}

test("GitHub classic: a missing repo or read:org blocks saving and says what to tick; a missing hook scope only warns", async ({ page }) => {
  await signIn(page, EMAIL, PASS)

  await openForm(page, "GitHub")
  await submit(page, "ghp_norepo", `perm-${tag}-norepo`)
  const list = page.getByRole("list", { name: "Token permissions" })
  await expect(list).toBeVisible()
  await expect(list.getByRole("listitem").filter({ hasText: "repo" }).first()).toContainText("Missing")
  await expect(page.getByText("The token is missing repo.")).toBeVisible()
  await expect(page.getByText(/open this token, tick repo, and Update token — the token itself stays the same/)).toBeVisible()
  expect(count(`perm-${tag}-norepo`)).toBe(0)

  await page.getByLabel("Token", { exact: true }).fill("ghp_noorg")
  await page.getByLabel("Name (optional)").fill(`perm-${tag}-noorg`)
  await page.getByRole("button", { name: "Check and save" }).click()
  await expect(page.getByText("The token is missing read:org.")).toBeVisible()
  await expect(list.getByRole("listitem").filter({ hasText: "read:org" })).toContainText("Missing")
  expect(count(`perm-${tag}-noorg`)).toBe(0)

  // write:org includes read:org.
  await page.getByLabel("Token", { exact: true }).fill("ghp_writeorg_nohook")
  await page.getByLabel("Name (optional)").fill(`perm-${tag}-nohook`)
  await page.getByRole("button", { name: "Check and save" }).click()
  await expect(page.getByRole("dialog", { name: "Keep a copy in Secrets?" })).toBeVisible()
  await page.getByRole("button", { name: "Not now" }).click()
  const after = page.getByRole("list", { name: "Token permissions" })
  await expect(after.getByRole("listitem").filter({ hasText: "admin:repo_hook" })).toContainText("Not granted")
  await expect(after.getByRole("listitem").filter({ hasText: "read:org" })).toContainText("Granted")
  expect(count(`perm-${tag}-nohook`)).toBe(1)
})

test("GitHub fine-grained: no scopes header, so a real ls-remote proves Contents access", async ({ page }) => {
  await signIn(page, EMAIL, PASS)
  await openForm(page, "GitHub")
  await submit(page, "github_pat_fine", `perm-${tag}-fine`)
  await expect(page.getByRole("dialog", { name: "Keep a copy in Secrets?" })).toBeVisible()
  await page.getByRole("button", { name: "Not now" }).click()
  const list = page.getByRole("list", { name: "Token permissions" })
  await expect(list.getByRole("listitem").filter({ hasText: "Repository access" })).toContainText("Granted")
  await expect(list.getByRole("listitem").filter({ hasText: "Contents: Read-only" })).toContainText("Granted")
  await expect(list.getByRole("listitem").filter({ hasText: "Webhooks: Read and write" })).toContainText("Can't tell")
  expect(count(`perm-${tag}-fine`)).toBe(1)
})

test("GitLab: no read_repository blocks; api alone passes", async ({ page }) => {
  await signIn(page, EMAIL, PASS)
  await openForm(page, "GitLab")
  await submit(page, "glpat-norepo", `perm-${tag}-glnorepo`, "http://localhost:3992")
  await expect(page.getByText("The token is missing read_repository.")).toBeVisible()
  await expect(page.getByText(/GitLab can't change an existing token's scopes, so create a new token with read_repository \(and api if you want backups on push\) and paste it here/)).toBeVisible()
  expect(count(`perm-${tag}-glnorepo`)).toBe(0)

  await page.getByLabel("Token", { exact: true }).fill("glpat-apionly")
  await page.getByLabel("Name (optional)").fill(`perm-${tag}-glapi`)
  await page.getByRole("button", { name: "Check and save" }).click()
  await expect(page.getByRole("dialog", { name: "Keep a copy in Secrets?" })).toBeVisible()
  await page.getByRole("button", { name: "Not now" }).click()
  const list = page.getByRole("list", { name: "Token permissions" })
  await expect(list.getByRole("listitem").filter({ hasText: "read_repository" })).toContainText("Granted")
  expect(count(`perm-${tag}-glapi`)).toBe(1)
})

test("saved tokens: Check permissions, and Replace token refuses one that lacks a permission", async ({ page }) => {
  // A job so the Settings tab (home of the saved tokens) opens.
  const conn = sql(`select id from git_backup_connections where user_id = ${who} and name = 'perm-${tag}-nohook'`)
  sql(`insert into git_backup_jobs (user_id, name, connection_id, dest_kind, paused) values (${who}, 'Perms ${tag}', '${conn}', 'nimbus', true)`)
  const job = sql(`select id from git_backup_jobs where name = 'Perms ${tag}'`)
  await signIn(page, EMAIL, PASS)
  await page.goto(`${BASE}?job=${job}&tab=settings`)

  const name = `perm-${tag}-nohook`
  await page.getByRole("button", { name: `Actions for ${name}` }).click()
  await page.getByRole("menuitem", { name: "Check permissions" }).click()
  const list = page.getByRole("list", { name: "Token permissions" })
  await expect(list.getByRole("listitem").filter({ hasText: "repo" }).first()).toContainText("Granted")
  await expect(list.getByRole("listitem").filter({ hasText: "admin:repo_hook" })).toContainText("Not granted")
  await page.getByRole("button", { name: "Close" }).click()

  await page.getByRole("button", { name: `Actions for ${name}` }).click()
  await page.getByRole("menuitem", { name: "Replace token" }).click()
  await page.getByLabel("New token").fill("ghp_noorg")
  await page.getByRole("button", { name: "Replace", exact: true }).click()
  await expect(page.getByText("The token is missing read:org.")).toBeVisible()
  await expect(page.getByText(/tick read:org, and Update token/)).toBeVisible()
  expect(sql(`select last4 from git_backup_connections where name = '${name}'`)).not.toBe("noorg")

  // Saved, but the optional push permission is missing: the toast says so.
  await page.getByLabel("New token").fill("ghp_nohook_again")
  await page.getByRole("button", { name: "Replace", exact: true }).click()
  await expect(page.getByText(/Replaced the token of “.*”\. It lacks admin:repo_hook, so backups on push won't work\./)).toBeVisible()
  expect(sql(`select last4 from git_backup_connections where name = '${name}'`)).toBe("gain")
})

for (const [label, port] of [["Gitea", 3910], ["Forgejo", 3911]] as const) {
  test(`${label}: a token with only read:user is missing repository and organization`, async ({ page }) => {
    test.setTimeout(420_000)
    execFileSync("bash", ["e2e/fixtures/git-hosts.sh"], { env: { ...process.env, OUT: HOSTS_OUT }, timeout: 360_000 })
    const url = `http://localhost:${port}`
    const mint = async (name: string, scopes: string[]) => {
      const r = await fetch(`${url}/api/v1/users/octo/tokens`, { method: "POST", headers: { authorization: BASIC, "content-type": "application/json" }, body: JSON.stringify({ name: `${name}-${tag}`, scopes }) })
      return ((await r.json()) as { sha1: string }).sha1
    }
    const limited = await mint("limited", ["read:user"])
    const full = await mint("full", ["read:user", "read:organization", "read:repository"])
    try {
      await signIn(page, EMAIL, PASS)
      await openForm(page, label)
      await submit(page, limited, `perm-${tag}-${label}-lim`, url)
      await expect(page.getByText("The token is missing organization: Read, repository: Read.")).toBeVisible()
      const list = page.getByRole("list", { name: "Token permissions" })
      await expect(list.getByRole("listitem").filter({ hasText: "user: Read" })).toContainText("Granted")
      await expect(list.getByRole("listitem").filter({ hasText: "organization: Read" })).toContainText("Missing")
      await expect(page.getByText(/Tokens can't be edited, so generate a new one under Settings → Applications with organization: Read, repository: Read/)).toBeVisible()
      expect(count(`perm-${tag}-${label}-lim`)).toBe(0)

      await page.getByLabel("Token", { exact: true }).fill(full)
      await page.getByLabel("Name (optional)").fill(`perm-${tag}-${label}-full`)
      await page.getByRole("button", { name: "Check and save" }).click()
      await expect(page.getByRole("dialog", { name: "Keep a copy in Secrets?" })).toBeVisible()
      await page.getByRole("button", { name: "Not now" }).click()
      await expect(page.getByRole("list", { name: "Token permissions" }).getByRole("listitem").filter({ hasText: "repository: Read" }).first()).toContainText("Granted")
      expect(count(`perm-${tag}-${label}-full`)).toBe(1)
    } finally {
      for (const n of ["limited", "full"]) await fetch(`${url}/api/v1/users/octo/tokens/${n}-${tag}`, { method: "DELETE", headers: { authorization: BASIC } }).catch(() => {})
    }
  })
}
