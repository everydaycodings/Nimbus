import { execFileSync } from "node:child_process"

import { expect, test } from "@playwright/test"

import { signIn } from "./helpers"

// Server Backup (/more/server-backup). Needs, besides the dev app and `npm run worker` (the app runs restic and ssh, so
// restic and openssh-client must be on the dev server's PATH):
//   - the dev MinIO on :9100 (EXTRA_S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY); this spec makes and removes a bucket
//   - Docker, for the server to back up. The spec starts and stops it; by hand:
//       docker run -d --rm --name nimbus-e2e-sb -p 127.0.0.1:2298:2222 -e USER_NAME=e2e -e PUBLIC_KEY="ssh-ed25519 AAAA placeholder" lscr.io/linuxserver/openssh-server
//     then the spec appends the public key Nimbus made for the host to /config/.ssh/authorized_keys (user e2e, home /config).
//     E2E_SB_PORT changes the host port.
// The server and MinIO are on this machine (private addresses), so the spec turns on Admin → Sharing → Secrets "allow private
// addresses" for its run and puts it back. Signs in as the dev admin (also a member; only admins may point Nimbus at localhost).
//   npx playwright test e2e/server-backup.spec.ts
const EMAIL = process.env.E2E_ADMIN ?? "admin-test@example.invalid"
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "admin-test-pass-123"
const MINIO = { endpoint: process.env.EXTRA_S3_ENDPOINT ?? "http://localhost:9100", accessKey: process.env.S3_ACCESS_KEY ?? "nimbus", secret: process.env.S3_SECRET_KEY ?? "nimbus-secret" }
const PORT = process.env.E2E_SB_PORT ?? "2298"
const DB = process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus"
const sql = (q: string) => execFileSync("psql", [DB, "-qAtc", q]).toString().trim()
const sh = (...cmd: string[]) => execFileSync(cmd[0], cmd.slice(1)).toString().trim()
const who = `(select id from "user" where email = '${EMAIL}')`
const tag = Date.now().toString(36)
const CONTAINER = `nimbus-e2e-sb-${tag}`
const BUCKET = `sb-${tag}`
const LABEL = `e2e server ${tag}`
const JOB = `e2e job ${tag}`
const HELLO = `hello ${tag}`
const jobId = () => sql(`select id from server_backup_jobs where name = '${JOB}'`)
const runs = () => Number(sql(`select count(*) from server_backup_runs where job_id = '${jobId()}'`))
const finished = () => Number(sql(`select count(*) from server_backup_runs where job_id = '${jobId()}' and status <> 'running'`))
const done = (n: number) => () => finished() >= n

let allowPrivate = "f"
let password = ""

test.describe.configure({ mode: "serial" })

test.beforeAll(async () => {
  allowPrivate = sql("select secret_allow_private::text from settings")
  sql("update settings set secret_allow_private = true, server_backup_enabled = true, server_backup_members = true")
  sql(`delete from server_backup_jobs where user_id = ${who}; delete from server_backup_hosts where user_id = ${who}`)
  sh("docker", "run", "-d", "--rm", "--name", CONTAINER, "-p", `127.0.0.1:${PORT}:2222`, "-e", "USER_NAME=e2e", "-e", "PUBLIC_KEY=ssh-ed25519 AAAA placeholder", "lscr.io/linuxserver/openssh-server")
  await expect.poll(() => sh("docker", "logs", CONTAINER), { timeout: 90_000 }).toContain("done.")
  // 3 MB of random data (so a second backup that adds almost nothing is meaningful) and one known file.
  sh("docker", "exec", CONTAINER, "sh", "-c", `mkdir -p /config/data/sub && head -c 3000000 /dev/urandom > /config/data/blob.bin && printf '${HELLO}' > /config/data/sub/hello.txt && chmod -R a+rX /config/data`)
  const { CreateBucketCommand, S3Client } = await import("@aws-sdk/client-s3")
  await new S3Client({ endpoint: MINIO.endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: MINIO.accessKey, secretAccessKey: MINIO.secret } }).send(new CreateBucketCommand({ Bucket: BUCKET }))
})

test.afterAll(async () => {
  sql(`update settings set secret_allow_private = ${allowPrivate}, server_backup_enabled = true`)
  sql(`delete from server_backup_jobs where user_id = ${who}; delete from server_backup_hosts where user_id = ${who}`)
  try {
    sh("docker", "rm", "-f", CONTAINER)
  } catch {}
  // The bucket and its repository objects are left for the dev MinIO's own cleanup (name carries `sb-${tag}`).
})

test("add a server, trust its host key, and back up a folder", async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page, EMAIL, PASS)
  await page.goto("/more/server-backup?view=servers")
  // With no servers yet the form is already open.
  const add = page.getByRole("button", { name: "Add a server" }).first()
  if (await add.isVisible()) await add.click()
  await page.getByLabel("Name", { exact: true }).fill(LABEL)
  await page.getByLabel("Host or IP address").fill("127.0.0.1")
  await page.getByLabel("Port").fill(PORT)
  await page.getByLabel("User").fill("e2e")
  await page.getByRole("button", { name: "Add server" }).click()
  await expect(page.getByText("Now let this server trust Nimbus")).toBeVisible()
  // The authorized_keys line is shown to copy; inject it into the container.
  const pub = sql(`select public_key from server_backup_hosts where label = '${LABEL}'`)
  await expect(page.getByText(pub.split(" ")[1])).toBeVisible()
  sh("docker", "exec", CONTAINER, "sh", "-c", `echo '${pub}' >> /config/.ssh/authorized_keys`)
  await page.getByRole("button", { name: "Done" }).click()
  await page.getByRole("button", { name: "Test connection" }).click()
  await expect(page.getByText(/Connected\. Host key recorded/)).toBeVisible({ timeout: 30_000 })
  expect(sql(`select host_key from server_backup_hosts where label = '${LABEL}'`)).toMatch(/^ssh-/)
  await expect(page.getByText(/^SHA256:/).first()).toBeVisible()

  // The wizard.
  await page.goto("/more/server-backup?view=new")
  await page.getByRole("radio", { name: new RegExp(LABEL) }).check()
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await page.getByLabel("Folders").fill("/config/data")
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await page.getByRole("radio", { name: /Another S3/ }).check()
  await page.getByLabel("Endpoint").fill(MINIO.endpoint)
  await page.getByLabel("Bucket", { exact: true }).fill(BUCKET)
  await page.getByLabel("Access key ID").fill(MINIO.accessKey)
  await page.getByLabel("Secret access key").fill(MINIO.secret)
  await page.getByRole("button", { name: "Test connection" }).click()
  await expect(page.getByText("Wrote, read and deleted a test file.")).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await page.getByLabel("Job name").fill(JOB)
  await page.getByRole("radio", { name: "Custom" }).check()
  await page.getByLabel("Minutes between checks").fill("1440")
  await page.getByRole("button", { name: "Create and back up" }).click()
  // The password is shown once.
  await expect(page.getByText("Save your repository password")).toBeVisible()
  password = (await page.locator("code").first().innerText()).trim()
  expect(password.length).toBeGreaterThan(30)
  await expect(page.getByRole("button", { name: "Open the job" })).toBeDisabled()
  await page.getByLabel("I saved the password somewhere safe").check()
  await page.getByRole("button", { name: "Open the job" }).click()
  await expect(page.getByRole("heading", { name: "Server backup" })).toBeVisible()

  await expect.poll(done(1), { timeout: 150_000 }).toBeTruthy()
  expect(sql(`select status from server_backup_runs where job_id = '${jobId()}' order by created_at limit 1`)).toBe("ok")
  expect(Number(sql(`select count(*) from server_backup_snapshots where job_id = '${jobId()}'`))).toBe(1)
  await page.reload()
  await expect(page.getByText("Everything is backed up")).toBeVisible()
})

test("a second run with nothing changed adds almost nothing", async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page, EMAIL, PASS)
  await page.goto(`/more/server-backup?job=${jobId()}`)
  await page.getByRole("button", { name: "Back up now" }).click()
  await expect.poll(done(2), { timeout: 150_000 }).toBeTruthy()
  const [first, second] = sql(`select added_bytes from server_backup_snapshots where job_id = '${jobId()}' order by taken_at`).split("\n").map(Number)
  expect(first).toBeGreaterThan(2_000_000)
  expect(second).toBeLessThan(200_000)
})

test("retention removes older snapshots", async ({ page }) => {
  test.setTimeout(240_000)
  sql(`update server_backup_jobs set retention = '{"daily":1,"weekly":0,"monthly":0}' where id = '${jobId()}'`)
  await signIn(page, EMAIL, PASS)
  await page.goto(`/more/server-backup?job=${jobId()}`)
  await page.getByRole("button", { name: "Back up now" }).click()
  await expect.poll(done(3), { timeout: 150_000 }).toBeTruthy()
  // All three ran today, so only the newest daily is kept.
  expect(Number(sql(`select count(*) from server_backup_snapshots where job_id = '${jobId()}'`))).toBe(1)
})

test("browse and download one file, copy the restic command", async ({ page }) => {
  await signIn(page, EMAIL, PASS)
  await page.goto(`/more/server-backup?job=${jobId()}&tab=snapshots`)
  await page.getByRole("button", { name: "Browse" }).click()
  for (const dir of ["config", "data", "sub"]) await page.getByRole("button", { name: dir, exact: true }).click()
  await expect(page.getByText("hello.txt")).toBeVisible({ timeout: 90_000 })
  const snap = sql(`select id from server_backup_snapshots where job_id = '${jobId()}'`)
  const res = await page.request.get(`/api/server-backup/snapshots/${snap}/download?path=${encodeURIComponent("config/data/sub/hello.txt")}`)
  expect(res.status()).toBe(200)
  expect(await res.text()).toBe(HELLO)
  const zip = await page.request.get(`/api/server-backup/snapshots/${snap}/download?path=${encodeURIComponent("config/data/sub")}&dir=1`)
  expect(zip.headers()["content-type"]).toContain("zip")

  await page.getByRole("button", { name: "Back" }).click()
  await page.getByRole("button", { name: /^More for the snapshot/ }).click()
  await page.getByRole("menuitem", { name: /Restore with restic/ }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("restic")
  await expect(dialog).toContainText("RESTIC_PASSWORD='<your restic repository password>'")
  await expect(dialog).not.toContainText(password)
})

test("restore over SSH to another path matches the original", async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page, EMAIL, PASS)
  await page.goto(`/more/server-backup?job=${jobId()}&tab=snapshots`)
  await page.getByRole("button", { name: /^More for the snapshot/ }).click()
  await page.getByRole("menuitem", { name: /Restore to the server/ }).click()
  await page.getByLabel("Folder on the server").fill("/config/restored")
  await page.getByRole("button", { name: "Restore", exact: true }).click()
  await expect(page.getByText("Restored to /config/restored.")).toBeVisible({ timeout: 120_000 })
  expect(sh("docker", "exec", CONTAINER, "cat", "/config/restored/config/data/sub/hello.txt")).toBe(HELLO)
  expect(sh("docker", "exec", CONTAINER, "sh", "-c", "cmp /config/data/blob.bin /config/restored/config/data/blob.bin && echo same")).toBe("same")
})

test("restore into Files", async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page, EMAIL, PASS)
  await page.goto(`/more/server-backup?job=${jobId()}&tab=snapshots`)
  await page.getByRole("button", { name: /^More for the snapshot/ }).click()
  await page.getByRole("menuitem", { name: /Restore into Files/ }).click()
  await page.getByRole("button", { name: "Restore here" }).click()
  await expect(page.getByText(/Restored \d+ files into Files\./)).toBeVisible({ timeout: 120_000 })
  expect(sql(`select count(*) from nodes n join nodes p on p.id = n.parent_id where n.owner_id = ${who} and n.name = 'hello.txt' and n.kind = 'file' and exists (select 1 from nodes r where r.owner_id = ${who} and r.name like '${JOB} %' and r.parent_id is null)`)).not.toBe("0")
  sql(`delete from nodes where owner_id = ${who} and name like '${JOB} %' and parent_id is null`)
})

test("a changed host key blocks runs and says why", async ({ page }) => {
  test.setTimeout(120_000)
  const was = sql(`select host_key from server_backup_hosts where label = '${LABEL}'`)
  // A different, valid ed25519 key in place of the recorded one.
  sql(`update server_backup_hosts set host_key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' where label = '${LABEL}'`)
  await signIn(page, EMAIL, PASS)
  await page.goto(`/more/server-backup?job=${jobId()}`)
  const before = runs()
  await page.getByRole("button", { name: "Back up now" }).click()
  await expect.poll(() => runs() > before && sql(`select status from server_backup_runs where job_id = '${jobId()}' order by created_at desc limit 1`), { timeout: 90_000 }).toBe("failed")
  expect(sql(`select error from server_backup_runs where job_id = '${jobId()}' order by created_at desc limit 1`)).toMatch(/host key/i)
  await page.goto(`/more/server-backup?job=${jobId()}&tab=history`)
  await page.getByRole("button", { name: /Failed/ }).first().click()
  await expect(page.getByText(/host key/i).first()).toBeVisible()
  sql(`update server_backup_hosts set host_key = '${was}' where label = '${LABEL}'`)
})

test("an admin turning the tool off makes the page 404", async ({ page }) => {
  sql("update settings set server_backup_enabled = false")
  await signIn(page, EMAIL, PASS)
  const res = await page.goto("/more/server-backup")
  expect(res?.status()).toBe(404)
  sql("update settings set server_backup_enabled = true, server_backup_members = false")
  // Admins keep it when only members are turned off.
  const ok = await page.goto("/more/server-backup")
  expect(ok?.status()).toBe(200)
  sql("update settings set server_backup_members = true")
})
