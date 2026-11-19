import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"
import { expect, test, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { signIn } from "./helpers"

// Git Backup on GitLab (the fake: node e2e/fixtures/fake-gitlab.mjs <dir> 3992), Gitea and Forgejo (real containers on :3910 and
// :3911, started here through e2e/fixtures/git-hosts.sh; docker needed). The app must run with GITBACKUP_WEBHOOK_BASE=http://host.docker.internal:3000
// (so the containers can deliver webhooks to it; the fakes map that name back to localhost) and the worker up. Archives go to the dev MinIO.
// secret_allow_private is switched on for the length of the spec (plain http to localhost) and put back. Everything made carries `tag`.
// SHOTS=dir for screenshots (default /tmp).
const EMAIL = process.env.E2E_ADMIN ?? "admin-test@example.invalid"
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "admin-test-pass-123"
const SHOTS = process.env.SHOTS ?? "/tmp"
const HOSTS_OUT = process.env.GIT_HOSTS_OUT ?? join(tmpdir(), "nimbus-git-hosts")
const MINIO = { endpoint: process.env.EXTRA_S3_ENDPOINT ?? "http://localhost:9100", accessKey: process.env.S3_ACCESS_KEY ?? "nimbus", secret: process.env.S3_SECRET_KEY ?? "nimbus-secret" }
const sql = (q: string) => execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()
const tag = Date.now().toString(36)
const BASE = "/more/github-backup"
const BUCKET = `gbh-${tag}`
const who = `(select id from "user" where email = '${EMAIL}')`
const s3 = new S3Client({ endpoint: MINIO.endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: MINIO.accessKey, secretAccessKey: MINIO.secret } })
const saved = { allowPrivate: "f" }

type Host = { p: "gitlab" | "gitea" | "forgejo"; label: string; url: string; repos: string[]; token: string; expires: boolean; push: (full: string) => Promise<void> }
const GITEA_REPOS = ["acme/api", "octo/hello", "octo/secret-notes"]
const hosts: Host[] = [
  { p: "gitlab", label: "GitLab", url: "http://localhost:3992", repos: [...GITEA_REPOS, "acme/platform/infra", "octo/forked"], token: "glpat-faketoken", expires: true, push: async (full) => void (await fetch(`http://localhost:3992/_test/push/${full}`, { method: "POST" })) },
  { p: "gitea", label: "Gitea", url: "http://localhost:3910", repos: GITEA_REPOS, token: "", expires: false, push: (full) => giteaPush("http://localhost:3910", hostsToken.gitea, full) },
  { p: "forgejo", label: "Forgejo", url: "http://localhost:3911", repos: GITEA_REPOS, token: "", expires: false, push: (full) => giteaPush("http://localhost:3911", hostsToken.forgejo, full) },
]
const hostsToken = { gitea: "", forgejo: "" }

// The bootstrap user's password login (git-hosts.sh), for making and deleting tokens.
const BASIC = `Basic ${Buffer.from("octo:e2e-pass-12345").toString("base64")}`
// A commit through the host's API (a new file each time).
async function giteaPush(url: string, token: string, full: string) {
  const r = await fetch(`${url}/api/v1/repos/${full}/contents/p-${Date.now()}.txt`, { method: "POST", headers: { authorization: `token ${token}`, "content-type": "application/json" }, body: JSON.stringify({ content: Buffer.from("x").toString("base64"), message: "push" }) })
  expect(r.ok, await r.clone().text()).toBeTruthy()
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true })
  await page.setViewportSize({ width: 375, height: 812 })
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(SHOTS, `git-backup-hosts-${name}-375.png`), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 720 })
}

const jobId = (name: string) => sql(`select id from git_backup_jobs where name = '${name}'`)
const lastRun = (id: string) => sql(`select trigger || '|' || status || '|' || changed from git_backup_runs where job_id = '${id}' order by created_at desc limit 1`)
const waitIdle = (id: string) => expect.poll(() => sql(`select count(*) from git_backup_runs where job_id = '${id}' and status = 'running'`), { timeout: 180_000, intervals: [1000] }).toBe("0")

async function backUpNow(page: Page, id: string) {
  await page.goto(`${BASE}?job=${id}`)
  const btn = page.getByRole("button", { name: "Back up now" })
  await expect(btn).toBeEnabled({ timeout: 60_000 })
  await btn.click()
  await expect(page.getByText("Backup started")).toBeVisible()
  await waitIdle(id)
}

test.describe.configure({ mode: "serial" })

test.beforeAll(async () => {
  test.setTimeout(400_000)
  saved.allowPrivate = sql("select secret_allow_private from settings")
  sql("update settings set secret_allow_private = true")
  execFileSync("bash", ["e2e/fixtures/git-hosts.sh"], { env: { ...process.env, OUT: HOSTS_OUT }, timeout: 360_000 })
  // A token of its own per host (so the bad-token step can delete it without touching the bootstrap one).
  for (const h of hosts.filter((h) => h.p !== "gitlab")) {
    const r = await fetch(`${h.url}/api/v1/users/octo/tokens`, { method: "POST", headers: { authorization: BASIC, "content-type": "application/json" }, body: JSON.stringify({ name: `e2e-${tag}`, scopes: ["all"] }) })
    const t = ((await r.json()) as { sha1?: string }).sha1
    expect(t, `token for ${h.p}`).toBeTruthy()
    h.token = t!
    hostsToken[h.p as "gitea" | "forgejo"] = t!
  }
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
})

test.afterAll(async () => {
  await fetch("http://localhost:3992/_test/revoke?on=0", { method: "POST" }).catch(() => {})
  sql(`delete from git_backup_jobs where name like '%${tag}'; delete from git_backup_connections where user_id = ${who} and name like 'h-${tag}%'`)
  sql(`update settings set secret_allow_private = ${saved.allowPrivate === "t"}`)
  for (const h of hosts.filter((h) => h.p !== "gitlab")) await fetch(`${h.url}/api/v1/users/octo/tokens/e2e-${tag}`, { method: "DELETE", headers: { authorization: BASIC } }).catch(() => {})
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET })).catch(() => null)
  if (listed?.Contents?.length) await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: listed.Contents.map((o) => ({ Key: o.Key! })) } }))
  await s3.send(new DeleteBucketCommand({ Bucket: BUCKET })).catch(() => {})
})

// The wizard's connect step: the form is already open when the member has no connections, else behind "Add a token".
async function openForm(page: Page) {
  await page.goto(`${BASE}?new=1`)
  const add = page.getByRole("button", { name: "Add a token" })
  if (await add.isVisible().catch(() => false)) await add.click()
  await expect(page.getByRole("radiogroup").or(page.getByRole("group", { name: "Where are your repos?" }))).toBeVisible()
}

test("provider cards: four choices, instructions and the server URL field per host", async ({ page }) => {
  await signIn(page, EMAIL, PASS)
  await openForm(page)
  const card = (n: string) => page.getByRole("radio", { name: new RegExp(n) })
  await expect(card("GitHub")).toBeChecked()
  await expect(page.getByLabel("Server URL")).toHaveCount(0)
  await shot(page, "cards-github")

  await card("GitLab").check()
  await expect(page.getByText("read_api")).toBeVisible()
  await expect(page.getByRole("link", { name: /Create one on GitLab/ })).toHaveAttribute("href", /gitlab\.com\/-\/user_settings\/personal_access_tokens/)
  await expect(page.getByLabel("Server URL (optional)")).toBeVisible()
  await expect(page.getByRole("button", { name: "Check and save" })).toBeDisabled()
  await page.getByLabel("Server URL (optional)").fill("git.example.com")
  await expect(page.getByRole("link", { name: /Create one on GitLab/ })).toHaveAttribute("href", /^https:\/\/git\.example\.com\/-\/user_settings/)
  await shot(page, "cards-gitlab")

  for (const [n, scope] of [["Gitea", "repository: Read"], ["Forgejo", "organization: Read"]] as const) {
    await card(n).check()
    await expect(page.getByText(scope).first()).toBeVisible()
    await expect(page.getByLabel("Server URL", { exact: true })).toBeVisible()
    // Required: a token alone isn't enough.
    await page.getByLabel("Token", { exact: true }).fill("tok")
    await expect(page.getByRole("button", { name: "Check and save" })).toBeDisabled()
    await page.getByLabel("Server URL", { exact: true }).fill("git.example.com")
    await expect(page.getByRole("button", { name: "Check and save" })).toBeEnabled()
    await shot(page, `cards-${n.toLowerCase()}`)
    await page.getByLabel("Server URL", { exact: true }).fill("")
  }
})

for (const h of hosts) {
  test(`${h.label}: connect, back up, change, restore, webhook, rejected token`, async ({ page }) => {
    test.setTimeout(480_000)
    const conn = `h-${tag}-${h.p}`
    const job = `${h.label} ${tag}`
    await signIn(page, EMAIL, PASS)

    await test.step("a bad token is refused with the host's own words", async () => {
      await openForm(page)
      await page.getByRole("radio", { name: new RegExp(h.label) }).check()
      await page.getByLabel(/^Server URL/).fill(h.url)
      await page.getByLabel("Token", { exact: true }).fill("bad")
      await page.getByRole("button", { name: "Check and save" }).click()
      await expect(page.getByRole("alert").filter({ hasText: `${h.label} didn't accept that token.` })).toBeVisible()
    })

    await test.step("connect with the token", async () => {
      await page.getByLabel("Token", { exact: true }).fill(h.token)
      await page.getByLabel("Name (optional)").fill(conn)
      await page.getByRole("button", { name: "Check and save" }).click()
      await page.getByRole("dialog", { name: "Keep a copy in Secrets?" }).getByRole("button", { name: "Not now" }).click()
      const status = page.getByRole("status").filter({ hasText: "Signed in as octo" })
      await expect(status).toBeVisible()
      if (h.expires) await expect(status).toContainText(/Expires .*2027/)
      else await expect(status).toContainText("Expiry unknown")
      expect(sql(`select provider || '|' || account || '|' || host from git_backup_connections where name = '${conn}'`)).toBe(`${h.p}|octo|http://${new URL(h.url).host}`)
      await page.getByRole("button", { name: "Next", exact: true }).click()
    })

    await test.step("storage: another S3 (dev MinIO)", async () => {
      await page.getByRole("radio", { name: /Another S3/ }).check()
      await page.getByLabel("Endpoint").fill(MINIO.endpoint)
      await page.getByLabel("Region").fill("us-east-1")
      await page.getByLabel("Bucket", { exact: true }).fill(BUCKET)
      await page.getByLabel("Access key ID").fill(MINIO.accessKey)
      await page.getByLabel("Secret access key").fill(MINIO.secret)
      await page.getByRole("button", { name: "Test connection" }).click()
      await expect(page.getByText("Wrote, read and deleted a test file.")).toBeVisible()
      await page.getByRole("button", { name: "Next", exact: true }).click()
    })

    await test.step("the picker lists your repos and the org's, private ones and subgroups included", async () => {
      await expect(page.getByRole("radio", { name: /Choose repos/ })).toBeChecked()
      // Forks are filtered out of the picker by default (they still join an "everything" job).
      for (const r of h.repos.filter((r) => r !== "octo/forked")) await expect(page.getByRole("checkbox", { name: new RegExp(`${r.replace("/", "\\/")}\\b`) })).toBeVisible()
      await expect(page.getByRole("option", { name: "octo (you)" })).toHaveCount(1)
      await expect(page.getByRole("option", { name: /^acme\b/ }).first()).toHaveCount(1)
      await shot(page, `picker-${h.p}`)
      await page.getByRole("radio", { name: /Everything this token can see/ }).check()
      await page.getByRole("button", { name: "Next", exact: true }).click()
      await page.getByLabel("Job name").fill(job)
      await page.getByLabel("Folder in the bucket").fill(`${h.p}-${tag}`)
      await page.getByRole("button", { name: "Create and back up" }).click()
      await expect(page).toHaveURL(/job=/)
    })

    const id = jobId(job)
    const n = h.repos.length
    await test.step("every repo is backed up, under the host's name", async () => {
      await expect.poll(() => lastRun(id), { timeout: 240_000, intervals: [2000] }).toBe(`first|ok|${n}`)
      expect(sql(`select count(*) from git_backup_snapshots s join git_backup_repos r on r.id = s.repo_id where r.job_id = '${id}'`)).toBe(String(n))
      const keys = sql(`select s.key from git_backup_snapshots s join git_backup_repos r on r.id = s.repo_id where r.job_id = '${id}' order by 1`).split("\n")
      expect(keys.every((k) => k.startsWith(`${h.p}-${tag}/localhost/`))).toBeTruthy()
      if (h.p === "gitlab") expect(keys.some((k) => k.includes("/localhost/acme/platform/infra/"))).toBeTruthy()
      await page.goto(`${BASE}?job=${id}&tab=repos`)
      await expect(page.getByText(`Backing up everything octo can see, new repos included.`)).toBeVisible()
      await shot(page, `repos-${h.p}`)
    })

    await test.step("unchanged: 0 changed; a push: 1 changed", async () => {
      await backUpNow(page, id)
      expect(lastRun(id)).toBe("manual|ok|0")
      await h.push("octo/hello")
      await backUpNow(page, id)
      expect(lastRun(id)).toBe("manual|ok|1")
      await page.goto(`${BASE}?job=${id}&tab=history`)
      await expect(page.getByRole("button", { name: /Manual/ }).first()).toContainText(`${n} checked · 1 changed`)
    })

    await test.step("restore: the archive's refs match the host's", async () => {
      const key = sql(`select s.key from git_backup_snapshots s join git_backup_repos r on r.id = s.repo_id where r.job_id = '${id}' and r.name = 'hello' order by s.created_at desc limit 1`)
      const dir = mkdtempSync(join(tmpdir(), "gbh-"))
      writeFileSync(join(dir, "a.tgz"), Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))).Body!.transformToByteArray()))
      execFileSync("tar", ["-xzf", join(dir, "a.tgz"), "-C", dir])
      const mine = execFileSync("git", ["--git-dir", join(dir, "hello.git"), "for-each-ref", "--format=%(objectname) %(refname)"]).toString().trim().split("\n").sort()
      const remote = `${new URL(h.url).protocol}//${h.p === "gitlab" ? "oauth2" : "octo"}:${h.token}@${new URL(h.url).host}/octo/hello.git`
      const theirs = execFileSync("git", ["ls-remote", "--refs", remote]).toString().trim().split("\n").map((l) => l.replace("\t", " ")).sort()
      expect(mine).toEqual(theirs)
      expect(mine.length).toBeGreaterThan(0)
      // The snapshot holds the pushed file, so it's this push and not the first one.
      expect(execFileSync("git", ["--git-dir", join(dir, "hello.git"), "ls-tree", "--name-only", "main"]).toString()).toMatch(/p-\d+\.txt|log\.txt/)
      expect(readFileSync(join(dir, "a.tgz")).length).toBeGreaterThan(100)
    })

    await test.step("webhook: a push starts a backup", async () => {
      await page.goto(`${BASE}?job=${id}&tab=settings`)
      await page.getByRole("switch", { name: "Back up on push" }).click()
      await expect.poll(() => sql(`select webhook_enabled from git_backup_jobs where id = '${id}'`)).toBe("t")
      await expect(page.getByText(/couldn.t get a webhook/)).toHaveCount(0)
      const hooks = () => sql(`select count(*) from git_backup_runs where job_id = '${id}' and trigger = 'webhook' and status = 'ok' and changed = 1`)
      if (h.p === "gitlab") {
        await h.push("octo/hello")
        const deliver = async (q = "") => (await (await fetch(`http://localhost:3992/_test/deliver/octo/hello${q}`, { method: "POST" })).json()) as { status: number; body: string }
        expect((await deliver("?bad=1")).status).toBe(401)
        expect(await deliver()).toMatchObject({ status: 200, body: expect.stringContaining('"started":1') })
      } else {
        // Real delivery: the host calls the app itself.
        await h.push("octo/hello")
      }
      await expect.poll(hooks, { timeout: 120_000, intervals: [1000] }).toBe("1")
      // A subgroup repo on GitLab is found by its full path.
      if (h.p === "gitlab") {
        await waitIdle(id)
        await h.push("acme/platform/infra")
        const r = (await (await fetch("http://localhost:3992/_test/deliver/acme/platform/infra", { method: "POST" })).json()) as { body: string }
        expect(r.body).toContain('"started":1')
        await waitIdle(id)
      }
      await page.goto(`${BASE}?job=${id}&tab=settings`)
      await page.getByRole("switch", { name: "Back up on push" }).click()
      await expect.poll(() => sql(`select webhook_enabled from git_backup_jobs where id = '${id}'`)).toBe("f")
    })

    await test.step("a rejected token is an error, not Source gone", async () => {
      await waitIdle(id)
      if (h.p === "gitlab") await fetch("http://localhost:3992/_test/revoke?on=1", { method: "POST" })
      else await fetch(`${h.url}/api/v1/users/octo/tokens/e2e-${tag}`, { method: "DELETE", headers: { authorization: BASIC } })
      try {
        await backUpNow(page, id)
        expect(lastRun(id)).toMatch(/^manual\|failed\|0$/)
        expect(sql(`select count(*) from git_backup_repos where job_id = '${id}' and status = 'gone'`)).toBe("0")
        expect(sql(`select count(*) from git_backup_repos where job_id = '${id}' and status = 'error' and last_error like '%token was rejected%'`)).toBe(String(n))
        await page.goto(`${BASE}?job=${id}&tab=repos`)
        await expect(page.getByText(/token was rejected/).first()).toBeVisible()
        await expect(page.getByText(/no longer shows this repo/)).toHaveCount(0)
      } finally {
        if (h.p === "gitlab") await fetch("http://localhost:3992/_test/revoke?on=0", { method: "POST" })
      }
    })

    await test.step("saved tokens list the host", async () => {
      await page.goto(`${BASE}?job=${id}&tab=settings`)
      await expect(page.getByText(conn, { exact: true }).first()).toBeVisible()
      await expect(page.getByText(h.label, { exact: true }).first()).toBeVisible()
    })
  })
}
