import { CreateBucketCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3"
import { expect, test, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

import { signToken } from "../lib/upload-rules"
import { signIn } from "./helpers"

// Git Backup paths the main spec leaves out, against the fake GitHub (OAuth, webhook, LFS) and the dev MinIO.
// Needs: fake on :3990, app started with GITHUB_API_URL and GITHUB_OAUTH_URL pointing at it, worker running with git-lfs on PATH
// (LFS_BIN=<dir holding git-lfs> for this spec's own git calls), mailpit (MAILPIT=http://localhost:8025, SMTP :1025), dev MinIO from .env.local.
// Everything it creates carries `tag` in its name and is deleted again; settings it flips are put back.
const FAKE = process.env.FAKE_GITHUB ?? "http://localhost:3990"
const MAILPIT = process.env.MAILPIT ?? "http://localhost:8025"
const EMAIL = process.env.E2E_ADMIN ?? "admin-test@example.invalid"
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "admin-test-pass-123"
const MINIO = { endpoint: process.env.EXTRA_S3_ENDPOINT ?? "http://localhost:9100", accessKey: process.env.S3_ACCESS_KEY ?? "nimbus", secret: process.env.S3_SECRET_KEY ?? "nimbus-secret" }
const sql = (q: string) => execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()
const tag = Date.now().toString(36)
const BASE = "/more/github-backup"
const BUCKET = `gbx-${tag}`
const CONN = `x-${tag}`
const JOB_W = `W ${tag}`
const JOB_L = `L ${tag}`
const LFS_REPO = `lfs-${tag}`
const who = `(select id from "user" where email = '${EMAIL}')`
const env = { ...process.env, PATH: [process.env.LFS_BIN, process.env.PATH].filter(Boolean).join(delimiter) }
const s3 = new S3Client({ endpoint: MINIO.endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: MINIO.accessKey, secretAccessKey: MINIO.secret } })

const jobId = (name: string) => sql(`select id from git_backup_jobs where name = '${name}'`)
const fakeGet = async (page: Page, path: string) => (await (await page.request.post(`${FAKE}${path}`)).json()) as Record<string, any>
let made: { oid: string; size: number }
const saved = { allowPrivate: "f", transport: "none", oauthId: "", oauthSecret: "" }
const notes = (where: string) => Number(sql(`select count(*) from notifications where user_id = ${who} and kind = 'git_backup' and ${where}`))
const mails = async () => ((await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent("to:" + EMAIL)}`)).json()) as { messages: { Subject: string }[] }).messages

test.describe.configure({ mode: "serial" })

test.beforeAll(async () => {
  const [a, t, i, s] = sql(`select secret_allow_private, email_transport, coalesce(github_oauth_client_id, ''), coalesce(github_oauth_client_secret, '') from settings`).split("|")
  Object.assign(saved, { allowPrivate: a, transport: t, oauthId: i, oauthSecret: s })
  // Private addresses (MinIO) and mail through mailpit for the length of this spec.
  sql(`update settings set secret_allow_private = true, email_transport = 'smtp'`)
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
  // Before the first wizard: the app caches a connection's repo list for five minutes.
  made = await (await fetch(`${FAKE}/_test/lfs?name=${LFS_REPO}`)).json()
})

test.afterAll(async () => {
  await fetch(`${FAKE}/_test/revoke?on=0`, { method: "POST" }).catch(() => {})
  sql(`delete from git_backup_jobs where name in ('${JOB_W}', '${JOB_L}'); delete from git_backup_connections where user_id = ${who} and (name like '${CONN}%' or via = 'oauth' and created_at > now() - interval '1 hour')`)
  sql(`delete from notifications where user_id = ${who} and kind = 'git_backup' and (data->>'job' in ('${JOB_W}', '${JOB_L}') or data->>'name' = '${CONN}')`)
  sql(`update settings set secret_allow_private = ${saved.allowPrivate === "t"}, email_transport = '${saved.transport}', github_oauth_client_id = ${saved.oauthId ? `'${saved.oauthId}'` : "null"}, github_oauth_client_secret = ${saved.oauthSecret ? `'${saved.oauthSecret}'` : "null"}`)
})

// The wizard end to end: token (first job only), Another S3 with the dev MinIO, one repo, LFS as asked.
async function createJob(page: Page, o: { name: string; repo: string; folder: string; lfs: boolean; badSecretFirst?: boolean }) {
  await page.goto(`${BASE}?new=1`)
  const existing = page.getByRole("radio", { name: new RegExp(CONN) })
  if (await existing.isVisible().catch(() => false)) await existing.check()
  else {
    const add = page.getByRole("button", { name: "Add a token" })
    if (await add.isVisible().catch(() => false)) await add.click()
    await page.getByLabel("Token", { exact: true }).fill("ghp_faketoken")
    await page.getByLabel("Name (optional)").fill(CONN)
    await page.getByRole("button", { name: "Check and save" }).click()
    await page.getByRole("dialog", { name: "Keep a copy in Secrets?" }).getByRole("button", { name: "Not now" }).click()
  }
  await expect(page.getByRole("status").filter({ hasText: "Signed in as octo" })).toBeVisible()
  await page.getByRole("button", { name: "Next", exact: true }).click()

  await page.getByRole("radio", { name: /Another S3/ }).check()
  await page.getByLabel("Endpoint").fill(MINIO.endpoint)
  await page.getByLabel("Region").fill("us-east-1")
  await page.getByLabel("Bucket", { exact: true }).fill(BUCKET)
  await page.getByLabel("Access key ID").fill(MINIO.accessKey)
  const next = page.getByRole("button", { name: "Next", exact: true })
  if (o.badSecretFirst) {
    await page.getByLabel("Secret access key").fill("wrong-secret")
    await page.getByRole("button", { name: "Test connection" }).click()
    await expect(page.getByText(/The storage refused these keys/)).toBeVisible()
    await expect(next).toBeDisabled()
  }
  await page.getByLabel("Secret access key").fill(MINIO.secret)
  await page.getByRole("button", { name: "Test connection" }).click()
  await expect(page.getByText("Wrote, read and deleted a test file.")).toBeVisible()
  await expect(next).toBeEnabled()
  await next.click()

  await page.getByRole("radio", { name: /Choose repos/ }).check()
  await page.getByPlaceholder("Search repos").fill(o.repo)
  await page.getByRole("checkbox", { name: new RegExp(`/${o.repo}\\b`) }).check()
  await next.click()

  await page.getByLabel("Job name").fill(o.name)
  await page.getByLabel("Folder in the bucket").fill(o.folder)
  const lfs = page.getByRole("switch", { name: /Include Git LFS files/ })
  if ((await lfs.isChecked()) !== o.lfs) await lfs.click()
  await page.getByRole("button", { name: "Create and back up" }).click()
  await expect(page).toHaveURL(/job=/)
}

const lastRun = (id: string) => sql(`select trigger || '|' || status || '|' || changed from git_backup_runs where job_id = '${id}' order by created_at desc limit 1`)
const waitIdle = (id: string) => expect.poll(() => sql(`select count(*) from git_backup_runs where job_id = '${id}' and status = 'running'`), { timeout: 120_000, intervals: [1000] }).toBe("0")

async function backUpNow(page: Page, id: string) {
  await page.goto(`${BASE}?job=${id}`)
  const btn = page.getByRole("button", { name: "Back up now" })
  await expect(btn).toBeEnabled({ timeout: 60_000 })
  await btn.click()
  await expect(page.getByText("Backup started")).toBeVisible()
  await waitIdle(id)
}

test("OAuth: Connect GitHub makes an oauth connection; a bad or reused state is refused", async ({ page }) => {
  await signIn(page, EMAIL, PASS)
  await page.goto("/admin/system/more-tools")
  await page.getByLabel("GitHub OAuth client ID").fill("fake-client-id")
  await page.getByLabel("GitHub OAuth client secret").fill("fake-client-secret")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect.poll(() => sql(`select github_oauth_client_id from settings`)).toBe("fake-client-id")

  await page.goto(`${BASE}?new=1`)
  await page.getByRole("link", { name: "Connect GitHub" }).click()
  await expect(page).toHaveURL(/connected=/)
  const id = new URL(page.url()).searchParams.get("connected")!
  expect(sql(`select via || '|' || account from git_backup_connections where id = '${id}'`)).toBe("oauth|octo")
  await expect(page.getByRole("status").filter({ hasText: "Signed in as octo" })).toBeVisible()

  // A made-up state, then one that works once and is spent.
  const callback = "/api/gitbackup/oauth/callback"
  expect((await page.request.get(`${callback}?code=fakecode&state=nope`, { maxRedirects: 0 })).headers().location).toContain("oauth_error=state")
  const start = await page.request.get("/api/gitbackup/oauth/start", { maxRedirects: 0 })
  const state = new URL(start.headers().location).searchParams.get("state")!
  expect((await page.request.get(`${callback}?code=fakecode&state=${state}`, { maxRedirects: 0 })).headers().location).toContain("connected=")
  expect((await page.request.get(`${callback}?code=fakecode&state=${state}`, { maxRedirects: 0 })).headers().location).toContain("oauth_error=state")
  // Right state but no cookie (another browser): refused too.
  const other = await page.request.get("/api/gitbackup/oauth/start", { maxRedirects: 0 })
  const st2 = new URL(other.headers().location).searchParams.get("state")!
  await page.context().clearCookies({ name: "gitbackup_oauth" })
  expect((await page.request.get(`${callback}?code=fakecode&state=${st2}`, { maxRedirects: 0 })).headers().location).toContain("oauth_error=state")
  await page.goto(`${BASE}?oauth_error=state`)
  await expect(page.getByRole("alert").filter({ hasText: "came from another browser" })).toBeVisible()
  expect(Number(sql(`select count(*) from git_backup_connections where user_id = ${who} and via = 'oauth'`))).toBeGreaterThanOrEqual(2)
})

test("external S3: wrong secret blocks, right one saves, archive lands in MinIO", async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page, EMAIL, PASS)
  await createJob(page, { name: JOB_W, repo: "hello", folder: `w-${tag}`, lfs: false, badSecretFirst: true })
  const id = jobId(JOB_W)
  await expect.poll(() => sql(`select count(*) from git_backup_snapshots s join git_backup_repos r on r.id = s.repo_id where r.job_id = '${id}'`), { timeout: 120_000 }).toBe("1")
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `w-${tag}/` }))
  expect(listed.Contents?.length).toBeGreaterThanOrEqual(2) // archive + manifest
})

test("webhook: signed push starts a run; bad signature and a switched-off job are refused", async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page, EMAIL, PASS)
  const id = jobId(JOB_W)
  await waitIdle(id)
  await page.goto(`${BASE}?job=${id}&tab=settings`)
  const sw = page.getByRole("switch", { name: "Back up on push" })
  await sw.click()
  await expect.poll(() => sql(`select webhook_enabled from git_backup_jobs where id = '${id}'`)).toBe("t")

  expect(await fakeGet(page, "/_test/push/octo/hello")).toMatchObject({ ok: true })
  expect((await fakeGet(page, "/_test/deliver/octo/hello?bad=1")).status).toBe(401)
  const ping = await fakeGet(page, "/_test/deliver/octo/hello?event=ping")
  expect(ping.status).toBe(200)
  const sent = await fakeGet(page, "/_test/deliver/octo/hello")
  expect(sent).toMatchObject({ status: 200, body: expect.stringContaining('"started":1') })
  await expect.poll(() => lastRun(id), { timeout: 120_000, intervals: [1000] }).toBe("webhook|ok|1")

  await page.reload()
  await sw.click()
  await expect.poll(() => sql(`select webhook_enabled from git_backup_jobs where id = '${id}'`)).toBe("f")
  expect((await fakeGet(page, "/_test/deliver/octo/hello?stale=1")).status).toBe(404)
})

test("LFS: snapshot is marked lfs and the archive holds the real file", async ({ page }) => {
  test.setTimeout(300_000)
  await signIn(page, EMAIL, PASS)
  await createJob(page, { name: JOB_L, repo: LFS_REPO, folder: `l-${tag}`, lfs: true })
  const id = jobId(JOB_L)
  await expect.poll(() => sql(`select count(*) from git_backup_snapshots s join git_backup_repos r on r.id = s.repo_id where r.job_id = '${id}'`), { timeout: 180_000 }).toBe("1")
  expect(sql(`select s.lfs from git_backup_snapshots s join git_backup_repos r on r.id = s.repo_id where r.job_id = '${id}'`)).toBe("t")
  expect(sql(`select status || '|' || coalesce(last_error, '') from git_backup_repos where job_id = '${id}'`)).toBe("ok|")

  // Restore by hand: download, untar, clone, bring the file back from the archive's lfs objects.
  const key = sql(`select s.key from git_backup_snapshots s join git_backup_repos r on r.id = s.repo_id where r.job_id = '${id}'`)
  const dir = mkdtempSync(join(tmpdir(), "gbx-"))
  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  writeFileSync(join(dir, "a.tgz"), Buffer.from(await obj.Body!.transformToByteArray()))
  execFileSync("tar", ["-xzf", join(dir, "a.tgz"), "-C", dir])
  const bare = join(dir, `${LFS_REPO}.git`)
  const stored = join(bare, "lfs", "objects", made.oid.slice(0, 2), made.oid.slice(2, 4), made.oid)
  expect(readFileSync(stored).length).toBe(made.size)
  const clone = join(dir, "clone")
  execFileSync("git", ["clone", "-q", bare, clone], { env: { ...env, GIT_LFS_SKIP_SMUDGE: "1" } })
  const into = join(clone, ".git", "lfs", "objects", made.oid.slice(0, 2), made.oid.slice(2, 4))
  mkdirSync(into, { recursive: true })
  copyFileSync(stored, join(into, made.oid))
  execFileSync("git", ["lfs", "install", "--local"], { cwd: clone, env })
  execFileSync("git", ["lfs", "checkout"], { cwd: clone, env })
  expect(readFileSync(join(clone, "big.bin"), "utf8")).toBe(`real lfs content ${LFS_REPO}\n`.repeat(50))
  expect(readdirSync(clone)).toContain(".gitattributes")
})

test("email and bell after two failures in a row, none for the third", async ({ page }) => {
  test.setTimeout(300_000)
  await signIn(page, EMAIL, PASS)
  const id = jobId(JOB_W)
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" })
  await fakeGet(page, "/_test/revoke?on=1")
  try {
    await backUpNow(page, id)
    expect(notes(`data->>'job' = '${JOB_W}'`)).toBe(0)
    await backUpNow(page, id)
    await expect.poll(() => notes(`data->>'event' = 'failed' and data->>'job' = '${JOB_W}'`), { timeout: 30_000 }).toBe(1)
    await expect.poll(async () => (await mails()).length, { timeout: 60_000, intervals: [1000] }).toBe(1)
    expect((await mails())[0].Subject).toContain("Git Backup")
    await backUpNow(page, id)
    await page.waitForTimeout(5000)
    expect(notes(`data->>'job' = '${JOB_W}'`)).toBe(1)
    expect((await mails()).length).toBe(1)
    expect(sql(`select fail_streak from git_backup_jobs where id = '${id}'`)).toBe("3")
  } finally {
    await fakeGet(page, "/_test/revoke?on=0")
  }
  // A good run resets the alert, so the next streak would warn again.
  await backUpNow(page, id)
  expect(sql(`select fail_streak || '|' || (alerted_at is null) from git_backup_jobs where id = '${id}'`)).toBe("0|true")
})

test("token expiry warning: sent once, links to Settings", async ({ page }) => {
  await signIn(page, EMAIL, PASS)
  sql(`update git_backup_connections set expires_at = now() + interval '3 days', warned_at = null where user_id = ${who} and name = '${CONN}'`)
  const trigger = async () => {
    const r = await page.request.post("/api/jobs", { headers: { authorization: `Bearer ${signToken("job", {}, 60_000)}`, "content-type": "application/json" }, data: { name: "git-backup-expiry", data: {} } })
    expect(r.ok()).toBeTruthy()
  }
  await trigger()
  const mine = `data->>'event' = 'expiring' and data->>'name' = '${CONN}'`
  await expect.poll(() => notes(mine)).toBe(1)
  expect(sql(`select (data->>'href') || '|' || (data->>'days') from notifications where user_id = ${who} and ${mine}`)).toBe("/more/github-backup?tab=settings|3")
  await trigger()
  await page.waitForTimeout(1500)
  expect(notes(mine)).toBe(1)
  // The bell shows it.
  await page.goto("/")
  await page.getByRole("button", { name: /Notifications/ }).click()
  await expect(page.getByText(new RegExp(`“${CONN}” expires in 3 days`)).first()).toBeVisible()
})
