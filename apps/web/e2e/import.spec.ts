import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { expect, test, type Page } from "@playwright/test"

import { newFolder, row, signIn, upload } from "./helpers"

// Cloud Import (/more/import). Needs, besides the dev app and `npm run worker`:
//   - rclone on the PATH of the dev server (the app runs it): https://rclone.org/downloads/
//   - the dev MinIO on :9100 (EXTRA_S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY); this spec makes and removes a bucket
//   - `zip` on this machine (builds the Takeout fixture)
//   - Docker, for an SFTP server. The spec starts and stops it; the equivalent by hand is
//       docker run -d --rm --name nimbus-e2e-sftp -p 127.0.0.1:2299:22 atmoz/sftp:alpine e2e:e2epass:::upload
//     (user e2e, password e2epass, writable folder /upload). E2E_SFTP_PORT changes the host port.
// The sources are on this machine (private addresses), so the spec turns on Admin → Sharing → Secrets "allow private
// addresses" for its run and puts it back. Signs in as the dev admin (also a member). Everything it makes carries `tag`.
//   npx playwright test e2e/import.spec.ts
const EMAIL = process.env.E2E_ADMIN ?? "admin-test@example.invalid"
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "admin-test-pass-123"
const MINIO = { endpoint: process.env.EXTRA_S3_ENDPOINT ?? "http://localhost:9100", accessKey: process.env.S3_ACCESS_KEY ?? "nimbus", secret: process.env.S3_SECRET_KEY ?? "nimbus-secret" }
const SFTP_PORT = process.env.E2E_SFTP_PORT ?? "2299"
const sql = (q: string) => execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()
const who = `(select id from "user" where email = '${EMAIL}')`
const tag = Date.now().toString(36)
const BUCKET = `imp-${tag}`
const SFTP = `nimbus-e2e-sftp-${tag}`
const DAV_PW = `e2ei-${tag}-aaaaa-bbbbb-ccccc-ddddd`
const FIX = new URL("fixtures", import.meta.url).pathname
const s3 = new S3Client({ endpoint: MINIO.endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: MINIO.accessKey, secretAccessKey: MINIO.secret } })
const sh = (cmd: string[]) => execFileSync(cmd[0], cmd.slice(1)).toString().trim()
const hash = (s: string) => createHash("sha256").update(s.replace(/[\s-]/g, "").toLowerCase()).digest("hex")

let allowPrivate = "f"
let tmp = ""

test.describe.configure({ mode: "serial" })

test.beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "nimbus-e2e-import-"))
  allowPrivate = sql("select secret_allow_private::text from settings")
  sql("update settings set secret_allow_private = true, import_tool_enabled = true")
  sql(`delete from import_jobs where user_id = ${who}; delete from import_connections where user_id = ${who}`)
  sql(`insert into app_passwords (user_id, name, scope, hash, last_four) values (${who}, 'e2e import ${tag}', 'ro', '${hash(DAV_PW)}', 'dddd')`)

  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
  for (const [Key, Body] of [["photos/a.txt", "alpha"], ["photos/sub/b.txt", "bravo"], ["docs/c.txt", "charlie"]])
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body }))

  sh(["docker", "run", "-d", "--rm", "--name", SFTP, "-p", `127.0.0.1:${SFTP_PORT}:22`, "atmoz/sftp:alpine", "e2e:e2epass:::upload"])
  await expect.poll(() => sh(["sh", "-c", `docker logs ${SFTP} 2>&1`]) + "x", { timeout: 30_000 }).toContain("Server listening")
  sh(["docker", "exec", SFTP, "sh", "-c", "printf sftp-one > /home/e2e/upload/s1.txt && printf sftp-two > /home/e2e/upload/s2.txt && touch -d '2020-02-02 12:00:00' /home/e2e/upload/s1.txt /home/e2e/upload/s2.txt"])

  // A Takeout zip: one photo with a JSON sidecar (taken 2019-01-01), and an album's metadata.json.
  const dir = join(tmp, "Takeout", "Google Photos", "Trip")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "pic.png"), readFileSync(join(FIX, "convert-image.png")))
  writeFileSync(join(dir, "pic.png.supplemental-metadata.json"), JSON.stringify({ title: "pic.png", photoTakenTime: { timestamp: "1546300800", formatted: "Jan 1, 2019" }, description: "A trip photo", favorited: true }))
  writeFileSync(join(dir, "metadata.json"), JSON.stringify({ title: "Trip" }))
  execFileSync("zip", ["-qr", join(tmp, `takeout-${tag}.zip`), "Takeout"], { cwd: tmp })
})

test.afterAll(async () => {
  sql(`update settings set secret_allow_private = ${allowPrivate}, import_tool_enabled = true`)
  sql(`delete from import_jobs where user_id = ${who} and name like '%${tag}'; delete from import_connections where user_id = ${who} and label like '%${tag}'`)
  sql(`delete from app_passwords where name = 'e2e import ${tag}'`)
  sql(`delete from nodes where owner_id = ${who} and (name like 'e2e import %${tag}%' or name like 'takeout-${tag}%') and trashed_at is null and parent_id is null`)
  sql(`delete from notifications where user_id = ${who} and kind in ('import_done', 'import_failed') and data->>'name' like '%${tag}'`)
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET })).catch(() => null)
  for (const o of listed?.Contents ?? []) await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: o.Key })).catch(() => {})
  await s3.send(new DeleteBucketCommand({ Bucket: BUCKET })).catch(() => {})
  await Promise.resolve().then(() => sh(["docker", "stop", SFTP])).catch(() => {})
  rmSync(tmp, { recursive: true, force: true })
})

const dialog = (page: Page) => page.getByRole("dialog")
const folderId = (name: string) => sql(`select id from nodes where owner_id = ${who} and name = '${name}' and kind = 'folder' and trashed_at is null`)
const jobId = (name: string) => sql(`select id from import_jobs where user_id = ${who} and name = '${name}'`)
const names = (parent: string) => sql(`select coalesce(string_agg(name, ',' order by name), '') from nodes where parent_id = '${parent}' and trashed_at is null`)
const lastRun = (job: string, col: string) => sql(`select ${col} from import_runs where job_id = '${job}' order by started_at desc limit 1`)
const runs = (job: string) => Number(sql(`select count(*) from import_runs where job_id = '${job}'`))
const finished = (job: string, n: number) => expect.poll(() => (runs(job) >= n ? lastRun(job, "status") : "waiting"), { timeout: 240_000, intervals: [2000] })

// A new empty folder at the top of Files, named for the test; returns its id.
async function target(page: Page, name: string) {
  await page.goto("/")
  await newFolder(page, name)
  return folderId(name)
}

// The wizard from "Source" on. `pick` runs on the Source step, `folders` ticks folders, `options` can change the toggles.
async function wizard(page: Page, o: { name: string; target: string; source: () => Promise<void>; folders?: () => Promise<void>; options?: () => Promise<void> }) {
  await page.goto("/more/import?new=1")
  await o.source()
  await page.getByRole("button", { name: "Next", exact: true }).click()
  if (o.folders) {
    await o.folders()
    await page.getByRole("button", { name: "Next", exact: true }).click()
  }
  await page.getByRole("button", { name: "Choose a folder" }).click()
  await dialog(page).getByRole("button", { name: o.target }).click()
  await dialog(page).getByRole("button", { name: "Import here" }).click()
  await expect(page.getByRole("button", { name: new RegExp(`/${o.target}`) })).toBeVisible()
  await page.getByLabel("Name this import").fill(o.name)
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await o.options?.()
  if (o.folders) await page.getByRole("button", { name: "Next", exact: true }).click()
  await page.getByRole("button", { name: "Create and import" }).click()
  await expect(page).toHaveURL(/job=/)
}

const addConnection = async (page: Page, provider: string, fill: Record<string, string>, label: string) => {
  const add = page.getByRole("button", { name: "Add a connection" })
  if (await add.isVisible()) await add.click()
  await page.getByRole("radio", { name: provider }).check()
  for (const [field, value] of Object.entries(fill)) await page.getByLabel(field, { exact: true }).fill(value)
  await page.getByLabel("Name (optional)", { exact: true }).fill(label)
  await page.getByRole("button", { name: "Check and save" }).click()
  await expect(page.getByRole("radio", { name: new RegExp(label) })).toBeChecked()
}

const openAndTick = async (page: Page, folder: string) => {
  await page.getByRole("button", { name: "Open Everything" }).click()
  await page.getByRole("checkbox", { name: new RegExp(`^${folder}`) }).check()
}

test("S3: connect, tick a folder, see the size, import with the tree, skip on a rerun, bell", async ({ page }) => {
  test.setTimeout(420_000)
  await signIn(page, EMAIL, PASS)
  const into = `e2e import s3 ${tag}`
  await target(page, into)
  const job = `S3 ${tag}`

  await test.step("a wrong key is refused and nothing is saved", async () => {
    await page.goto("/more/import?new=1")
    await expect(page.getByRole("heading", { name: "Cloud import", level: 1 })).toBeVisible()
    await page.getByRole("radio", { name: "S3 storage" }).check()
    await page.getByLabel("Endpoint", { exact: true }).fill(MINIO.endpoint)
    await page.getByLabel("Bucket (optional)").fill(BUCKET)
    await page.getByLabel("Access key", { exact: true }).fill(MINIO.accessKey)
    await page.getByLabel("Secret key", { exact: true }).fill("definitely-wrong")
    await page.getByRole("button", { name: "Check and save" }).click()
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText(/denied|refused|signature|credentials|forbidden/i)
    expect(sql(`select count(*) from import_connections where user_id = ${who}`)).toBe("0")
  })

  await wizard(page, {
    name: job,
    target: into,
    source: async () => {
      await addConnection(page, "S3 storage", { Endpoint: MINIO.endpoint, "Bucket (optional)": BUCKET, "Access key": MINIO.accessKey, "Secret key": MINIO.secret }, `minio ${tag}`)
    },
    folders: async () => {
      await openAndTick(page, "photos")
      await expect(page.getByText(/2 files/).first()).toBeVisible()
      await expect(page.getByText("measuring…")).toHaveCount(0)
    },
  })

  const id = jobId(job)
  await test.step("the first import brings the tree over", async () => {
    await finished(id, 1).toBe("ok")
    const root = folderId(into)
    expect(names(root)).toBe("photos")
    expect(names(sql(`select id from nodes where parent_id = '${root}' and name = 'photos'`))).toBe("a.txt,sub")
    expect(sql(`select count(*) from import_items where job_id = '${id}' and status = 'imported'`)).toBe("2")
    expect(sql(`select size from nodes where parent_id = (select id from nodes where parent_id = (select id from nodes where parent_id = '${root}' and name = 'photos') and name = 'sub') and name = 'b.txt' and trashed_at is null`)).toBe("5")
    // The stored copy carries a hash, for the duplicate finder.
    expect(sql(`select count(*) from file_versions v join nodes n on n.id = v.node_id where n.name = 'a.txt' and n.parent_id = (select id from nodes where parent_id = '${root}' and name = 'photos') and v.sha256 is not null`)).toBe("1")
    expect(Number(sql(`select count(*) from notifications where user_id = ${who} and kind = 'import_done' and data->>'name' = '${job}'`))).toBe(1)
  })

  await test.step("run it again: everything is skipped, nothing is added", async () => {
    await page.goto(`/more/import?job=${id}`)
    await expect(page.getByText("Up to date")).toBeVisible()
    await page.getByRole("button", { name: "Import now" }).click()
    await finished(id, 2).toBe("ok")
    expect(lastRun(id, "files_done || '/' || files_skipped")).toBe("0/2")
    expect(sql(`with recursive t as (select id from nodes where id = '${folderId(into)}' union all select n.id from nodes n join t on n.parent_id = t.id) select count(*) from nodes where id in (select id from t) and name in ('a.txt', 'b.txt') and trashed_at is null`)).toBe("2")
    await page.goto(`/more/import?job=${id}&tab=history`)
    await expect(page.getByText("Manual").first()).toBeVisible()
    await page.goto(`/more/import?job=${id}&tab=items`)
    await expect(page.getByText("photos/sub/b.txt")).toBeVisible()
  })

  await test.step("a new object at the source is picked up on the next run", async () => {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: "photos/new.txt", Body: "fresh" }))
    await page.goto(`/more/import?job=${id}`)
    await page.getByRole("button", { name: "Import now" }).click()
    await finished(id, 3).toBe("ok")
    expect(lastRun(id, "files_done || '/' || files_skipped")).toBe("1/2")
  })

  await test.step("375px wide: no sideways scroll on any tab", async () => {
    await page.setViewportSize({ width: 375, height: 800 })
    for (const tab of ["", "&tab=items", "&tab=history", "&tab=settings"]) {
      await page.goto(`/more/import?job=${id}${tab}`)
      await expect(page.getByRole("tablist")).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    await page.setViewportSize({ width: 1280, height: 800 })
  })
})

test("SFTP: keeps the file's date, and a name already taken keeps both", async ({ page }) => {
  test.setTimeout(420_000)
  await signIn(page, EMAIL, PASS)
  const into = `e2e import sftp ${tag}`
  const dir = await target(page, into)
  const job = `SFTP ${tag}`
  // A different file already has the name s1.txt.
  await page.goto(`/folders/${dir}`)
  await upload(page, "s1.txt", "mine")

  await wizard(page, {
    name: job,
    target: into,
    source: async () => {
      await addConnection(page, "SFTP", { Host: "127.0.0.1", Port: SFTP_PORT, "User name": "e2e", Password: "e2epass" }, `sftp ${tag}`)
    },
    folders: async () => {
      await openAndTick(page, "upload")
      await expect(page.getByText(/2 files/).first()).toBeVisible()
    },
    // Straight into the folder, so s1.txt meets the one already there.
    options: async () => {
      await page.getByRole("checkbox", { name: /Keep the folder structure/ }).uncheck()
      await expect(page.getByRole("checkbox", { name: /Keep the original dates/ })).toBeChecked()
    },
  })
  const id = jobId(job)
  await finished(id, 1).toBe("ok")
  expect(names(dir)).toBe("s1 (1).txt,s1.txt,s2.txt")
  // Mine is untouched; the imported copy is the server's.
  expect(sql(`select size from nodes where parent_id = '${dir}' and name = 's1.txt'`)).toBe("4")
  expect(sql(`select size from nodes where parent_id = '${dir}' and name = 's1 (1).txt'`)).toBe("8")
  expect(sql(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from nodes where parent_id = '${dir}' and name = 's2.txt'`)).toBe("2020-02-02 12:00")
  expect(sql(`select to_char(v.created_at at time zone 'UTC', 'YYYY-MM-DD') from file_versions v join nodes n on n.id = v.node_id where n.parent_id = '${dir}' and n.name = 's2.txt'`)).toBe("2020-02-02")

  // Rerun: s2.txt and the second copy of s1 are known; nothing new.
  await page.goto(`/more/import?job=${id}`)
  await page.getByRole("button", { name: "Import now" }).click()
  await finished(id, 2).toBe("ok")
  expect(names(dir)).toBe("s1 (1).txt,s1.txt,s2.txt")
  expect(lastRun(id, "files_done")).toBe("0")

  // The private key path: a pasted key that isn't one is refused before anything is sent.
  await page.goto("/more/import?view=connections")
  await page.getByRole("button", { name: "Add a connection" }).click()
  await page.getByRole("radio", { name: "SFTP" }).check()
  await page.getByLabel("Host", { exact: true }).fill("127.0.0.1")
  await page.getByLabel("User name", { exact: true }).fill("e2e")
  await page.getByLabel("Or a private key").fill("not a key")
  await page.getByRole("button", { name: "Check and save" }).click()
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText("doesn't look like a private key")
})

test("Nimbus WebDAV with an app password", async ({ page }) => {
  test.setTimeout(300_000)
  await signIn(page, EMAIL, PASS)
  const src = `e2e import davsrc ${tag}`
  const srcId = await target(page, src)
  await page.goto(`/folders/${srcId}`)
  await upload(page, "dav-note.txt", "from my own webdav")
  const into = `e2e import dav ${tag}`
  const dir = await target(page, into)
  const job = `DAV ${tag}`

  await wizard(page, {
    name: job,
    target: into,
    source: async () => {
      await addConnection(page, "WebDAV", { "WebDAV address": `http://localhost:3404/dav`, "User name (optional)": EMAIL, "Password (optional)": DAV_PW }, `dav ${tag}`)
    },
    folders: async () => {
      await openAndTick(page, src)
      await expect(page.getByText(/1 file\b/).first()).toBeVisible()
    },
  })
  const id = jobId(job)
  await finished(id, 1).toBe("ok")
  const root = sql(`select id from nodes where parent_id = '${dir}' and name = '${src}'`)
  expect(names(root)).toBe("dav-note.txt")
  expect(sql(`select size from nodes where parent_id = '${root}'`)).toBe("18")
})

test("Google Takeout: the photo date comes from the JSON sidecar, which isn't imported", async ({ page }) => {
  test.setTimeout(300_000)
  await signIn(page, EMAIL, PASS)
  await page.goto("/")
  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "New", exact: true }).click()
  await page.getByRole("menuitem", { name: "File upload" }).click()
  await (await chooser).setFiles({ name: `takeout-${tag}.zip`, mimeType: "application/zip", buffer: readFileSync(join(tmp, `takeout-${tag}.zip`)) })
  await expect(row(page, `takeout-${tag}.zip`)).toBeVisible()

  const into = `e2e import takeout ${tag}`
  const dir = await target(page, into)
  const job = `Takeout ${tag}`
  await page.goto("/more/import?new=1")
  await page.getByRole("radio", { name: /Google Takeout zips/ }).check()
  await page.getByLabel("Search your zip files").fill(`takeout-${tag}`)
  await page.getByRole("checkbox", { name: new RegExp(`takeout-${tag}.zip`) }).check()
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await page.getByRole("button", { name: "Choose a folder" }).click()
  await dialog(page).getByRole("button", { name: into }).click()
  await dialog(page).getByRole("button", { name: "Import here" }).click()
  await page.getByLabel("Name this import").fill(job)
  await page.getByRole("button", { name: "Next", exact: true }).click()
  await page.getByRole("checkbox", { name: /Keep descriptions/ }).check()
  await page.getByRole("button", { name: "Create and import" }).click()
  await expect(page).toHaveURL(/job=/)

  const id = jobId(job)
  await finished(id, 1).toBe("ok")
  const album = sql(`select id from nodes where parent_id = (select id from nodes where parent_id = '${dir}' and name = 'Google Photos') and name = 'Trip'`)
  // The metadata files are not files; the photo is.
  expect(names(album)).toBe("pic.png")
  expect(sql(`with recursive t as (select id from nodes where id = '${dir}' union all select n.id from nodes n join t on n.parent_id = t.id) select count(*) from nodes where id in (select id from t) and name ilike '%.json' and trashed_at is null`)).toBe("0")
  // The date Photos reads: taken_at on the version (else created_at).
  expect(sql(`select to_char(v.taken_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from file_versions v join nodes n on n.id = v.node_id where n.parent_id = '${album}' and n.name = 'pic.png'`)).toBe("2019-01-01 00:00")
  expect(sql(`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD') from nodes where parent_id = '${album}' and name = 'pic.png'`)).toBe("2019-01-01")
  // The favorite flag is ignored unless asked; the description became a comment.
  expect(sql(`select count(*) from comments c join nodes n on n.id = c.node_id where n.parent_id = '${album}' and c.body = 'A trip photo'`)).toBe("1")
  expect(sql(`select count(*) from stars s join nodes n on n.id = s.node_id where n.parent_id = '${album}'`)).toBe("0")

  // Rerun: known, skipped.
  await page.goto(`/more/import?job=${id}`)
  await page.getByRole("button", { name: "Import now" }).click()
  await finished(id, 2).toBe("ok")
  expect(lastRun(id, "files_done || '/' || files_skipped")).toBe("0/1")
})

test("the admin switch: off is a 404 and leaves the More card out", async ({ page }) => {
  await signIn(page, EMAIL, PASS)
  try {
    sql("update settings set import_tool_enabled = false")
    const res = await page.goto("/more/import")
    expect(res?.status()).toBe(404)
    await page.goto("/more")
    await expect(page.getByText("Cloud import")).toHaveCount(0)
  } finally {
    sql("update settings set import_tool_enabled = true")
  }
  await page.goto("/more")
  await expect(page.getByRole("link", { name: /Cloud import/ })).toBeVisible()
  await page.goto("/more/import")
  await expect(page.getByRole("heading", { name: "Cloud import", level: 1 })).toBeVisible()
})
