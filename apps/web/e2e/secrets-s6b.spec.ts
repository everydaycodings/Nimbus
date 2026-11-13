import { expect, request as pwRequest, test, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { makeZip } from "client-zip"

import { PASSWORD, ME, signIn, unique, upload } from "./helpers"

// S6b: KMS API, leak scanning, HIBP, health, imports from other tools, root key card.
// One sign-in for the whole file (3 sign-ins per 10 s is the limit). Worker jobs are
// forwarded through /api/jobs, as the worker would. Set E2E_SHOTS=dir for screenshots.
const API = "/api/v1/secrets"
const db = (q: string) => execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()
const fx = (n: string) => readFileSync(join("lib/secrets/fixtures/import", n))
const jobToken = () => execFileSync("node", ["--env-file=.env.local", "--input-type=module", "-e", "import {signToken} from './lib/upload-rules.ts'; console.log(signToken('job',{},60000))"]).toString().trim()
const fileText = (nodeId: string) =>
  execFileSync("node", ["--env-file=.env.local", "--input-type=module", "-e", "import {getText} from './lib/s3.ts'; getText(process.env.K).then(t=>{process.stdout.write(t);process.exit(0)})"], {
    env: { ...process.env, K: db(`select s3_key from nodes where id='${nodeId}'`) },
  }).toString()
const run = (page: Page, name: string, data: object) => page.request.post("/api/jobs", { headers: { authorization: `Bearer ${jobToken()}` }, data: { name, data } })

// Fresh fake keys each run (false positives are remembered per member, by hash), built
// from parts so no real scanner flags this file.
const rand = (chars: string, n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
const AWS = "AKIA" + rand("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", 16)
const GH = "ghp_" + rand("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 36)
const STRIPE = "sk_live_" + rand("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 28)

async function shotOf(p: Page, name: string) {
  const dir = process.env.E2E_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    await p.setViewportSize({ width: w, height: h })
    await p.waitForTimeout(250)
    await p.screenshot({ path: join(dir, `${name}-${w}.png`), fullPage: true })
  }
}
// E2E_ROT_PHASE=1|2|3 runs only the root-key rotation tests, against a scratch instance
// on its own database (see the end of this file); without it the rest run.
const PHASE = process.env.E2E_ROT_PHASE
test.describe("secrets S6b", () => {
test.skip(Boolean(PHASE))
test.describe.configure({ mode: "serial" })
let page: Page
let baseURL: string
test.beforeAll(async ({ browser }, info) => {
  baseURL = info.project.use.baseURL!
  page = await browser.newPage({ baseURL })
  await signIn(page)
  await page.goto("/secrets")
  await page.getByLabel("Your Nimbus password").fill(PASSWORD)
  await page.getByRole("button", { name: "Unlock", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible()
})
test.afterAll(async () => {
  db("update settings set secret_leak_scan = true, secret_hibp = true")
  await page.close()
})

const shot = async (name: string) => {
  const dir = process.env.E2E_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(dir, `${name}-${w}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1280, height: 720 })
}

const newProject = async () => ((await (await page.request.post(`${API}/projects`, { data: { name: unique("s6b") } })).json()) as { id: string }).id
const envs = async (id: string) => ((await (await page.request.get(`${API}/projects/${id}/envs`)).json()) as { envs: { id: string; slug: string }[] }).envs
const bearer = (token: string) => pwRequest.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${token}` } })

test("KMS: keys, try-it, rotation keeps old ciphertext, disable, tokens with scopes, audit has no plaintext", async () => {
  const id = await newProject()
  await page.goto(`/secrets/${id}?view=kms`)
  await expect(page.getByRole("heading", { name: "KMS", exact: true })).toBeVisible()
  await expect(page.getByText("No KMS keys yet")).toBeVisible()

  const make = async (name: string, kind: string) => {
    await page.getByRole("button", { name: "New key" }).first().click()
    await page.getByLabel("Name", { exact: true }).fill(name)
    await page.getByLabel("Type").selectOption(kind)
    await page.getByRole("button", { name: "Create key" }).click()
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
  }
  await make("pay", "aes")
  await make("rel", "ed25519")
  await make("rel256", "p256")

  const tryit = page.getByRole("region", { name: "Try it" })
  const secretText = "card 4242 ✓ très secret"
  await tryit.getByLabel("Key", { exact: true }).selectOption("pay")
  await tryit.getByLabel("Text", { exact: true }).fill(secretText)
  await tryit.getByLabel("Context (optional)").fill("order-7")
  await tryit.getByRole("button", { name: "Encrypt" }).click()
  const out1 = tryit.getByRole("status")
  await expect(out1).toContainText("nkms:v1:pay:1:")
  const ct1 = (await out1.textContent())!.trim()
  await shot("kms")

  // Decrypt; a wrong context is refused.
  await tryit.getByLabel("Operation").selectOption("decrypt")
  await tryit.getByLabel("Ciphertext").fill(ct1)
  await tryit.getByRole("button", { name: "Decrypt" }).click()
  await expect(out1).toHaveText(secretText)
  await tryit.getByLabel("Context (optional)").fill("order-8")
  await tryit.getByRole("button", { name: "Decrypt" }).click()
  await expect(tryit.getByRole("alert")).toContainText("Couldn't decrypt")
  await tryit.getByLabel("Context (optional)").fill("order-7")

  // Rotate: the new version is used for new work; the old ciphertext still opens.
  await page.getByRole("button", { name: "Actions for pay" }).click()
  await page.getByRole("menuitem", { name: "Rotate to a new version" }).click()
  await expect(page.getByText("AES-256-GCM · version 2")).toBeVisible()
  await tryit.getByRole("button", { name: "Decrypt" }).click()
  await expect(tryit.getByRole("status")).toHaveText(secretText)
  await tryit.getByLabel("Operation").selectOption("encrypt")
  await tryit.getByLabel("Text", { exact: true }).fill("again")
  await tryit.getByRole("button", { name: "Encrypt" }).click()
  await expect(tryit.getByRole("status")).toContainText("nkms:v1:pay:2:")

  // Signing: Ed25519 and P-256; a different message does not verify.
  for (const key of ["rel", "rel256"]) {
    await tryit.getByLabel("Key", { exact: true }).selectOption(key)
    await tryit.getByLabel("Operation").selectOption("sign")
    await tryit.getByLabel("Text", { exact: true }).fill("release-1.2.3.tgz")
    await tryit.getByRole("button", { name: "Sign" }).click()
    await expect(tryit.getByRole("status")).toContainText(`nkms:v1:${key}:1:`)
    const sig = (await tryit.getByRole("status").textContent())!.trim()
    await tryit.getByLabel("Operation").selectOption("verify")
    await tryit.getByLabel("Signature").fill(sig)
    await tryit.getByRole("button", { name: "Verify" }).click()
    await expect(tryit.getByRole("status")).toContainText("Valid")
    await tryit.getByLabel("Text", { exact: true }).fill("release-1.2.4.tgz")
    await tryit.getByRole("button", { name: "Verify" }).click()
    await expect(tryit.getByRole("status")).toContainText("Not valid")
  }

  // Machine tokens: only the scopes they were given.
  const [dev] = await envs(id)
  const mk = async (name: string, scopes: string[]) =>
    ((await (await page.request.post(`${API}/projects/${id}/tokens`, { data: { name, envIds: [dev.id], access: "ro", scopes } })).json()) as { token: string }).token
  const encOnly = await bearer(await mk("kms-enc", ["kms:encrypt"]))
  const none = await bearer(await mk("no-scope", []))
  const b64 = Buffer.from("api secret payload").toString("base64")
  const enc = await encOnly.post(`${API}/kms/encrypt`, { data: { key: "pay", data: b64, context: "svc" } })
  expect(enc.status()).toBe(200)
  const apiCt = (await enc.json()).ciphertext as string
  expect(apiCt).toMatch(/^nkms:v1:pay:2:/)
  expect((await encOnly.post(`${API}/kms/decrypt`, { data: { key: "pay", ciphertext: apiCt, context: "svc" } })).status()).toBe(403)
  expect((await none.post(`${API}/kms/encrypt`, { data: { key: "pay", data: b64 } })).status()).toBe(403)
  expect((await none.get(`${API}/kms/keys`)).status()).toBe(403)
  expect((await (await encOnly.get(`${API}/kms/keys`)).json()).keys.map((k: { name: string }) => k.name)).toEqual(["pay", "rel", "rel256"])
  const both = await bearer(await mk("kms-both", ["kms:encrypt", "kms:decrypt", "kms:sign", "kms:verify"]))
  const dec = await both.post(`${API}/kms/decrypt`, { data: { key: "pay", ciphertext: apiCt, context: "svc" } })
  expect(Buffer.from((await dec.json()).data, "base64").toString()).toBe("api secret payload")
  expect((await both.post(`${API}/kms/sign`, { data: { key: "pay", data: b64 } })).status()).toBe(409) // an AES key doesn't sign
  const sg = await (await both.post(`${API}/kms/sign`, { data: { key: "rel", data: b64 } })).json()
  expect((await (await both.post(`${API}/kms/verify`, { data: { key: "rel", data: b64, signature: sg.signature } })).json()).valid).toBe(true)
  expect((await (await both.post(`${API}/kms/verify`, { data: { key: "rel", data: Buffer.from("x").toString("base64"), signature: sg.signature } })).json()).valid).toBe(false)
  expect((await both.post(`${API}/kms/encrypt`, { data: { key: "nope", data: b64 } })).status()).toBe(404)

  // Disabled: refused for everyone, old versions included; enabling restores it.
  await page.getByRole("button", { name: "Actions for pay" }).click()
  await page.getByRole("menuitem", { name: "Disable" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Disable" }).click()
  await expect(page.getByText(/version 2 · made .* · disabled/)).toBeVisible()
  expect((await both.post(`${API}/kms/decrypt`, { data: { key: "pay", ciphertext: apiCt, context: "svc" } })).status()).toBe(409)
  await page.getByRole("button", { name: "Actions for pay" }).click()
  await page.getByRole("menuitem", { name: "Enable" }).click()
  await expect.poll(async () => (await both.post(`${API}/kms/decrypt`, { data: { key: "pay", ciphertext: apiCt, context: "svc" } })).status()).toBe(200)

  // Audit: every operation, none with plaintext, ciphertext or signatures.
  const rows = db(`select action || ' | ' || coalesce(detail,'') from audit_events where project_id='${id}' and action like 'secrets_kms_%'`)
  for (const a of ["encrypt", "decrypt", "sign", "verify", "key_create", "key_rotate", "key_disable"]) expect(rows).toContain(`secrets_kms_${a}`)
  for (const leak of [secretText, "api secret payload", b64, "nkms:v1", apiCt.slice(-12), sg.signature.slice(-12)]) expect(rows).not.toContain(leak)
  expect(rows).toMatch(/pay v2, \d+ bytes \(machine token, /)
  // Material is sealed in the database.
  expect(db(`select material_enc from secret_kms_versions v join secret_kms_keys k on k.id=v.key_id where k.project_id='${id}' and k.name='pay' and version=1`)).toMatch(/^v1\./)

  // Deleting a key is confirmed and final.
  await page.getByRole("button", { name: "Actions for rel256" }).click()
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Delete key" }).click()
  await expect(page.getByText("rel256", { exact: true })).toHaveCount(0)
  expect(db(`select count(*) from secret_kms_versions v join secret_kms_keys k on k.id=v.key_id where k.name='rel256' and k.project_id='${id}'`)).toBe("0")
})

test("leak scanning: upload, scan, masked findings, false positive, move and redact, admin off", async () => {
  const stamp = Date.now().toString(36)
  const name = `leaky-${stamp}.env`
  const clean = `clean-${stamp}.env`
  const body = `# deploy config\nAWS_ACCESS_KEY_ID=${AWS}\nGITHUB_TOKEN=${GH}\nNAME=nimbus\n`
  const me = `(select id from "user" where email='${ME}')`
  db(`delete from nodes where owner_id=${me} and (name like 'leaky-%' or name like 'clean-%' or name like 'again-%' or name like 'off-%')`)
  db(`delete from secret_leak_allow where user_id=${me}`)
  await page.goto("/")
  await upload(page, name, body)
  await upload(page, clean, "PORT=3000\nNAME=nimbus\n")
  const owner = `(select id from "user" where email='${ME}')`
  const nodeId = db(`select id from nodes where name='${name}' and owner_id=${owner} order by created_at desc limit 1`)
  const cleanId = db(`select id from nodes where name='${clean}' and owner_id=${owner} order by created_at desc limit 1`)

  expect((await run(page, "leak-scan", { nodeId: cleanId })).status()).toBe(204)
  expect(db(`select count(*) from secret_leaks where node_id='${cleanId}'`)).toBe("0")
  expect((await run(page, "leak-scan", { nodeId })).status()).toBe(204)
  expect(db(`select count(*) from secret_leaks where node_id='${nodeId}'`)).toBe("2")

  // Only a hash and a masked preview are stored, never the match.
  const stored = db(`select string_agg(rule || '|' || line || '|' || masked || '|' || hash, ';' order by line) from secret_leaks where node_id='${nodeId}'`)
  expect(stored).not.toContain(AWS)
  expect(stored).not.toContain(GH)
  expect(stored).toContain(`aws-access-key|2|AKIA…${AWS.slice(-2)}`)
  expect(stored).toContain(`github-token|3|ghp_…${GH.slice(-2)}`)
  expect(db(`select count(*) from notifications where user_id=${owner} and kind='secrets' and data->>'text' like '%possible secret%${name}%'`)).toBe("1")
  // A second scan of the same file adds nothing and tells nobody again.
  await run(page, "leak-scan", { nodeId })
  expect(db(`select count(*) from secret_leaks where node_id='${nodeId}'`)).toBe("2")
  expect(db(`select count(*) from notifications where user_id=${owner} and kind='secrets' and data->>'text' like '%${name}%'`)).toBe("1")

  await page.goto("/secrets/leaks")
  await expect(page.getByRole("heading", { name: "Leaks", exact: true })).toBeVisible()
  const awsRow = page.getByRole("listitem").filter({ hasText: "AWS access key" }).filter({ hasText: name })
  const ghRow = page.getByRole("listitem").filter({ hasText: "GitHub token" }).filter({ hasText: name })
  await expect(awsRow).toContainText("line 2")
  await expect(awsRow).toContainText(`AKIA…${AWS.slice(-2)}`)
  await expect(page.getByText(AWS)).toHaveCount(0)
  await expect(awsRow.getByRole("link", { name })).toHaveAttribute("href", new RegExp(`open=${nodeId}`))
  await shot("leaks")

  // False positive: gone from Open, in Closed, and a rescan doesn't bring it back.
  await ghRow.getByRole("button", { name: "False positive" }).click()
  await expect(ghRow).toHaveCount(0)
  await run(page, "leak-scan", { nodeId })
  expect(db(`select status from secret_leaks where node_id='${nodeId}' and rule='github-token'`)).toBe("false_positive")
  await page.getByRole("tab", { name: "Closed" }).click()
  await expect(page.getByRole("listitem").filter({ hasText: "GitHub token" }).filter({ hasText: "False positive" })).toBeVisible()
  await page.getByRole("tab", { name: "Open" }).click()

  // Move to Secrets, redacting the file.
  const projectId = await newProject()
  const projectName = db(`select name from secret_projects where id='${projectId}'`)
  await page.reload()
  await page.getByRole("listitem").filter({ hasText: "AWS access key" }).filter({ hasText: name }).getByRole("button", { name: "Move to Secrets" }).click()
  const dlg = page.getByRole("dialog")
  await dlg.getByLabel("Project").selectOption({ label: projectName })
  await expect(dlg.getByLabel("Key name")).toHaveValue("AWS_ACCESS_KEY_ID")
  await expect(dlg.getByLabel("Environment")).toHaveText(/Development/)
  await dlg.getByRole("button", { name: "Move", exact: true }).click()
  await expect(dlg).toHaveCount(0)
  expect(db(`select status from secret_leaks where node_id='${nodeId}' and rule='aws-access-key'`)).toBe("moved")
  const [dev] = await envs(projectId)
  const got = (await (await page.request.get(`${API}/projects/${projectId}/secrets?env=development&values=true`)).json()) as { secrets: { key: string; value: string }[] }
  expect(got.secrets).toEqual([{ key: "AWS_ACCESS_KEY_ID", value: AWS }])
  expect(dev.id).toBeTruthy()
  expect(db(`select count(*) from file_versions where node_id='${nodeId}'`)).toBe("2")
  const after = fileText(nodeId)
  expect(after).not.toContain(AWS)
  expect(after).toContain("AWS_ACCESS_KEY_ID=REDACTED")
  expect(after).toContain(GH) // the false positive stays as it was

  // Scan my files: queued, then the worker's job finds new ones across files.
  const again = `again-${stamp}.sh`
  await page.goto("/")
  await upload(page, again, `export STRIPE=${STRIPE}\n`)
  await page.goto("/secrets/leaks")
  await page.getByRole("button", { name: "Scan my files" }).click()
  await expect(page.getByText("Scanning your files")).toBeVisible()
  const done = await run(page, "leak-scan-user", { userId: db(`select ${owner}`) })
  expect(done.status()).toBe(204)
  await page.reload()
  await expect(page.getByRole("listitem").filter({ hasText: "Stripe key" }).filter({ hasText: again })).toBeVisible()

  // Dismiss, then reopen from Closed.
  await page.getByRole("listitem").filter({ hasText: again }).getByRole("button", { name: "Dismiss" }).click()
  await expect(page.getByRole("listitem").filter({ hasText: again })).toHaveCount(0)
  await page.getByRole("tab", { name: "Closed" }).click()
  await page.getByRole("listitem").filter({ hasText: again }).getByRole("button", { name: "Reopen" }).click()
  await page.getByRole("tab", { name: "Open" }).click()
  await expect(page.getByRole("listitem").filter({ hasText: again })).toBeVisible()

  // Admin off: nothing new is scanned and the button is gone.
  db("update settings set secret_leak_scan = false")
  const off = `off-${stamp}.env`
  await page.goto("/")
  await upload(page, off, `KEY=${AWS}\n`)
  await run(page, "leak-scan", { nodeId: db(`select id from nodes where name='${off}' and owner_id=${owner} order by created_at desc limit 1`) })
  expect(db(`select count(*) from secret_leaks l join nodes n on n.id=l.node_id where n.name='${off}'`)).toBe("0")
  await page.goto("/secrets/leaks")
  await expect(page.getByText("An admin turned file scanning off")).toBeVisible()
  await expect(page.getByRole("button", { name: "Scan my files" })).toHaveCount(0)
  db("update settings set secret_leak_scan = true")

  // Clean up: our files and projects.
  db(`delete from nodes where owner_id=${owner} and name in ('${name}','${clean}','${again}','${off}')`)
})

test("HIBP: warns from a k-anonymity range, quiet when offline or off, real service tolerated", async () => {
  const id = await newProject()
  const sha = createHash("sha1").update("password").digest("hex").toUpperCase()
  // The browser sends only the 5-character prefix.
  const seen: string[] = []
  await page.route("**/api/v1/secrets/pwned*", async (route) => {
    const prefix = new URL(route.request().url()).searchParams.get("prefix")!
    seen.push(prefix)
    await route.fulfill({ json: { ok: true, range: `0018A45C4D1DEF81644B54AB7F969B88D65:1\n${sha.slice(5)}:9545824` } })
  })
  await page.goto(`/secrets/${id}?view=items`)
  await page.getByRole("button", { name: "New item" }).click()
  await page.getByRole("button", { name: "Login", exact: true }).click()
  await page.getByLabel("Password", { exact: true }).fill("password")
  await expect(page.getByText("appears in 9,545,824 known data breaches")).toBeVisible()
  expect(seen).toEqual([sha.slice(0, 5)])
  await page.getByLabel("Password", { exact: true }).fill("T7q!rzV9-long-unique-passphrase-xx")
  await expect(page.getByText("known data breach")).toHaveCount(0)
  await shot("hibp")

  // Offline: a quiet note, nothing blocked.
  await page.unroute("**/api/v1/secrets/pwned*")
  await page.route("**/api/v1/secrets/pwned*", (route) => route.fulfill({ json: { ok: false } }))
  await page.getByLabel("Password", { exact: true }).fill("another one 123")
  await expect(page.getByText("Couldn't check this against known breaches right now.")).toBeVisible()
  await page.getByLabel("Name", { exact: true }).fill("Offline login")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByRole("button", { name: /Offline login/ })).toBeVisible()
  await page.unroute("**/api/v1/secrets/pwned*")

  // A secret named *PASSWORD* is checked when edited; one named TOKEN isn't.
  const hits: string[] = []
  await page.route("**/api/v1/secrets/pwned*", async (route) => {
    hits.push(route.request().url())
    await route.fulfill({ json: { ok: true, range: `${sha.slice(5)}:12` } })
  })
  await page.goto(`/secrets/${id}`)
  await page.getByRole("button", { name: "Development", exact: true }).click()
  // The page may not be hydrated yet: click again until the row appears.
  await expect(async () => {
    await page.getByRole("button", { name: "Add secret" }).click()
    await expect(page.getByLabel("New secret key").first()).toBeVisible({ timeout: 1500 })
  }).toPass()
  await page.getByLabel("New secret key").fill("API_TOKEN")
  await page.getByLabel("New secret value").fill("password")
  await page.waitForTimeout(1200)
  expect(hits).toHaveLength(0)
  await page.getByLabel("New secret key").fill("DB_PASSWORD")
  await page.getByLabel("New secret value").fill("password")
  await expect(page.getByText("appears in 12 known data breaches")).toBeVisible()
  await page.unroute("**/api/v1/secrets/pwned*")

  // The server route: real range service (or a clean "unavailable" offline), and admin off.
  const real = await (await page.request.get(`${API}/pwned?prefix=${sha.slice(0, 5)}`)).json()
  if (real.ok) expect(real.range).toContain(sha.slice(5))
  else expect(real).toEqual({ ok: false })
  expect(await (await page.request.get(`${API}/pwned?prefix=zz`)).json()).toEqual({ ok: false })
  db("update settings set secret_hibp = false")
  expect(await (await page.request.get(`${API}/pwned?prefix=${sha.slice(0, 5)}`)).json()).toEqual({ ok: false, disabled: true })
  db("update settings set secret_hibp = true")
})

test("health: score and lists, values never leave the server, every line links to its fix", async () => {
  const id = await newProject()
  const [dev, stg] = await envs(id)
  const put = (envId: string, ops: object[]) => page.request.post(`${API}/projects/${id}/secrets`, { data: { envId, ops } })
  const reusedValue = "Zx9!reused-value-4567"
  expect((await put(dev.id, [
    { key: "DB_PASSWORD", value: "hunter2" },
    { key: "SESSION_SECRET", value: reusedValue },
    { key: "API_TOKEN", value: reusedValue },
    { key: "OLD_SECRET", value: "r7Xk29!dQw0vLz4mPa8Tb" },
    { key: "ONLY_IN_DEV", value: "some-value-1" },
    { key: "LOG_LEVEL", value: "debug" },
  ])).status()).toBe(200)
  expect((await put(stg.id, [{ key: "LOG_LEVEL", value: "info" }])).status()).toBe(200)
  await page.request.put(`${API}/projects/${id}/required`, { data: { key: "STRIPE_KEY", kind: "any" } })
  db(`update secrets set updated_at = now() - interval '400 days' where project_id='${id}' and key='OLD_SECRET'`)
  await page.request.post(`${API}/projects/${id}/items`, { data: { kind: "api_key", name: "Expiring key", data: { token: "tok-1234567890" }, expiresAt: new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10) } })
  const tokenId = ((await (await page.request.post(`${API}/projects/${id}/tokens`, { data: { name: "idle token", envIds: [dev.id], access: "ro" } })).json()) as { id: string }).id
  db(`update secret_tokens set created_at = now() - interval '45 days' where id='${tokenId}'`)

  const api = await (await page.request.get(`${API}/projects/${id}/health`)).text()
  for (const v of ["hunter2", reusedValue, "r7Xk29!dQw0vLz4mPa8Tb", "some-value-1", "tok-1234567890"]) expect(api).not.toContain(v)
  expect(api).not.toMatch(/[0-9a-f]{64}/) // no hashes either

  await page.goto(`/secrets/${id}?view=health`)
  await expect(page.getByRole("heading", { name: "Health", exact: true })).toBeVisible()
  const score = Number((await page.getByLabel(/Score \d+ out of 100/).textContent())!.trim())
  expect(score).toBeLessThan(80)
  const sec = (title: string | RegExp) => page.getByRole("region", { name: title })
  await expect(sec("Weak secrets")).toContainText("DB_PASSWORD")
  await expect(sec("Weak secrets")).toContainText("Only 7 characters")
  await expect(sec("Reused secrets")).toContainText("SESSION_SECRET, API_TOKEN")
  await expect(sec(/Not changed in 180 days/)).toContainText("OLD_SECRET")
  await expect(sec("Required keys")).toContainText("STRIPE_KEY")
  await expect(sec("Environment drift")).toContainText("ONLY_IN_DEV")
  await expect(sec("Expiring soon")).toContainText("Expiring key")
  await expect(sec("Unused tokens")).toContainText("idle token")
  await expect(page.locator("body")).not.toContainText(reusedValue)
  await shot("health")

  // The window can change; lines link to the place that fixes them.
  await page.getByLabel("Treat secrets as old after").selectOption("365")
  await expect(sec(/Not changed in 365 days/)).toContainText("OLD_SECRET")
  await sec("Unused tokens").getByRole("button", { name: /idle token/ }).click()
  await expect(page.getByRole("tab", { name: "Machine tokens" })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByText("idle token").first()).toBeVisible()
  await page.goto(`/secrets/${id}?view=health`)
  await sec("Expiring soon").getByRole("button", { name: /Expiring key/ }).click()
  await expect(page.getByRole("heading", { name: "Items", exact: true })).toBeVisible()
  await page.goto(`/secrets/${id}?view=health`)
  await sec("Weak secrets").getByRole("button", { name: /DB_PASSWORD/ }).click()
  await expect(page.getByLabel("New secret key").or(page.getByLabel("Value of DB_PASSWORD")).or(page.getByRole("button", { name: "Reveal value of DB_PASSWORD" })).first()).toBeVisible()

  // Open leak findings of the viewer show too, linking to the Leaks page.
  const owner = `(select id from "user" where email='${ME}')`
  const node = db(`select id from nodes where owner_id=${owner} limit 1`)
  db(`insert into secret_leaks (owner_id, node_id, rule, line, masked, hash) values (${owner}, '${node}', 'jwt', 1, 'eyJh…ab', 'healthtest${Date.now()}')`)
  await page.goto(`/secrets/${id}?view=health`)
  await expect(sec("Leaked in files")).toContainText("1 open finding")
  await sec("Leaked in files").getByRole("link").click()
  await expect(page).toHaveURL(/\/secrets\/leaks/)
  db(`delete from secret_leaks where hash like 'healthtest%'`)
})

test("imports: every tool maps keys to secrets and logins/notes to Items, with preview, overwrite and skip", async () => {
  const id = await newProject()
  const [dev] = await envs(id)
  const preview = async (tool: string, name: string, text?: string, base64?: string) =>
    (await page.request.post(`${API}/projects/${id}/secrets/import`, { data: { mode: "preview-tool", envId: dev.id, tool, name, text, base64 } })).json() as Promise<{ rows: { key: string; value: string; status: string }[]; entries?: { kind: string; name: string; status: string }[]; errors: string[]; message?: string }>

  const inf = await preview("infisical", "e.json", fx("infisical.json").toString())
  expect(inf.rows.map((r) => r.key)).toEqual(["DATABASE_URL", "STRIPE_SECRET_KEY", "MULTILINE"])
  expect(inf.errors.join()).toContain("not a valid key name")
  const infCsv = await preview("infisical", "e.csv", fx("infisical.csv").toString())
  expect(infCsv.rows.find((r) => r.key === "GREETING")!.value).toBe('hello, "world"')
  const dop = await preview("doppler", "d.json", fx("doppler.json").toString())
  expect(dop.rows.map((r) => r.key)).toEqual(["API_KEY", "DEBUG", "DB_PASSWORD"])
  const pux = Buffer.from(await new Response(makeZip([{ name: "export.attributes", input: "{}" }, { name: "export.data", input: fx("1password.1pux.json") }])).arrayBuffer())
  const onep = await preview("1password", "x.1pux", undefined, pux.toString("base64"))
  expect(onep.entries!.map((e) => `${e.kind}:${e.name}`)).toEqual(["login:GitHub", "note:House notes", "api_key:Deploy token"])
  const onepCsv = await preview("1password", "x.csv", fx("1password.csv").toString())
  expect(onepCsv.rows.map((r) => r.key)).toEqual(["OPENAI_API_KEY"])
  const kp = await preview("keepass", "k.xml", fx("keepass.xml").toString())
  expect(kp.rows.map((r) => r.key)).toEqual(["SMTP_PASSWORD"])
  expect(kp.entries!.map((e) => e.name)).toEqual(["Forum", "Plain note"])
  expect((await preview("bitwarden", "b.json", fx("bitwarden-encrypted.json").toString())).message).toMatch(/encrypted/)
  expect((await preview("keepass", "k.xml", "<html/>")).message).toMatch(/KeePass/)

  // The dialog: Bitwarden's file, per-row Overwrite/Skip, then both land.
  await page.goto(`/secrets/${id}`)
  await page.getByRole("button", { name: "Development", exact: true }).click()
  const dlg = page.getByRole("dialog")
  await expect(async () => {
    await page.getByRole("button", { name: "Import", exact: true }).click()
    await expect(dlg).toBeVisible({ timeout: 1500 })
  }).toPass()
  await dlg.getByLabel("Or import an export from another tool").selectOption("bitwarden")
  await dlg.getByLabel("Choose an export file").setInputFiles({ name: "bitwarden.json", mimeType: "application/json", buffer: fx("bitwarden.json") })
  await expect(dlg.getByText("STRIPE_WEBHOOK_SECRET")).toBeVisible()
  await expect(dlg.getByText("2 items (logins, API keys, notes)")).toBeVisible()
  await expect(dlg.getByText("Skipped “Amex”")).toBeVisible()
  await shot("import")
  await dlg.getByLabel("What to do with Server notes").selectOption("skip")
  await dlg.getByRole("button", { name: /^Import 1 secret and 1 item$/ }).click()
  await expect(dlg).toHaveCount(0)
  expect((await (await page.request.get(`${API}/projects/${id}/secrets?env=development&values=true`)).json()).secrets).toEqual([{ key: "STRIPE_WEBHOOK_SECRET", value: "whsec_0123456789abcdef" }])
  const items = (await (await page.request.get(`${API}/projects/${id}/items`)).json()).items as { name: string; kind: string; id: string }[]
  expect(items.map((i) => i.name)).toEqual(["Jira"])

  // Again: the login now exists, so it's flagged and starts as Skip; overwrite replaces it.
  await page.getByRole("button", { name: "Import", exact: true }).click()
  await dlg.getByLabel("Or import an export from another tool").selectOption("bitwarden")
  await dlg.getByLabel("Choose an export file").setInputFiles({ name: "bitwarden.json", mimeType: "application/json", buffer: fx("bitwarden.json") })
  await expect(dlg.getByLabel("What to do with Jira")).toHaveValue("skip")
  await dlg.getByLabel("What to do with Jira").selectOption("go")
  await dlg.getByLabel("What to do with STRIPE_WEBHOOK_SECRET").selectOption("skip")
  await dlg.getByRole("button", { name: /^Import 0 secrets and 2 items$/ }).click()
  await expect(dlg).toHaveCount(0)
  const jira = items.find((i) => i.name === "Jira")!
  const opened = await (await page.request.get(`${API}/projects/${id}/items/${jira.id}`)).json()
  expect(opened.data).toMatchObject({ username: "octo", password: "jira-pass-12345", url: "https://jira.example.test", totp: "JBSWY3DPEHPK3PXP" })
  expect(((await (await page.request.get(`${API}/projects/${id}/items`)).json()).items as { name: string }[]).map((i) => i.name).sort()).toEqual(["Jira", "Server notes"])

  // A .1pux through the dialog (a real zip).
  await page.getByRole("button", { name: "Import", exact: true }).click()
  await dlg.getByLabel("Or import an export from another tool").selectOption("1password")
  await dlg.getByLabel("Choose an export file").setInputFiles({ name: "export.1pux", mimeType: "application/zip", buffer: pux })
  await expect(dlg.getByText("3 items (logins, API keys, notes)")).toBeVisible()
  await dlg.getByRole("button", { name: /^Import 0 secrets and 3 items$/ }).click()
  await expect(dlg).toHaveCount(0)
  await page.goto(`/secrets/${id}?view=items`)
  for (const n of ["GitHub", "House notes", "Deploy token"]) await expect(page.getByRole("button", { name: new RegExp(n) })).toBeVisible()
})

test("client views: tokens dialog offers KMS scopes", async () => {
  const id = await newProject()
  await page.goto(`/secrets/${id}?view=access`)
  await page.getByRole("tab", { name: /Machine tokens|Tokens/ }).click().catch(() => {})
  await page.getByRole("button", { name: /New token/ }).click()
  await expect(page.getByText("KMS operations (optional)")).toBeVisible()
  for (const op of ["Encrypt", "Decrypt", "Sign", "Verify"]) await expect(page.getByRole("checkbox", { name: op })).toBeVisible()
})
})

// Root key rotation through the admin page. Runs in three phases against a scratch copy of
// the app (own database, own Redis DBs; scripts in the scratchpad start the server each
// time): 1 sets up an owner, a project and a secret under key A; 2 restarts with key B
// current and A previous, presses Re-wrap and forwards the worker job; 3 restarts with
// only key B and proves everything still opens.
test.describe("root key rotation", () => {
  test.skip(!PHASE)
  test.describe.configure({ mode: "serial" })
  const OWNER = "s6b-owner@example.invalid"
  const VALUE = "rotation-proof-value-8841"
  const state = process.env.E2E_ROT_FILE ?? "/tmp/s6b-rot.json"

  async function ownerPage(browser: import("@playwright/test").Browser, info: import("@playwright/test").TestInfo, create = false) {
    const p = await browser.newPage({ baseURL: info.project.use.baseURL! })
    if (create) {
      await p.goto("/sign-up")
      await p.getByLabel("Name").fill("S6b Owner")
      await p.getByLabel("Email").fill(OWNER)
      await p.getByLabel("Password", { exact: true }).fill(PASSWORD)
      await p.getByRole("button", { name: /Create account|Sign up/ }).click()
      await expect(p).not.toHaveURL(/sign-up/)
    } else {
      await signIn(p, OWNER)
    }
    await p.goto("/secrets")
    await p.getByLabel("Your Nimbus password").fill(PASSWORD)
    await p.getByRole("button", { name: "Unlock", exact: true }).click()
    await expect(p.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible()
    return p
  }
  const projectId = async (p: Page) => ((await (await p.request.get(`${API}/projects`)).json()) as { projects: { id: string; name: string }[] }).projects.find((x) => x.name === "rotation proof")!.id
  const readValue = async (p: Page) => {
    const id = await projectId(p)
    const r = (await (await p.request.get(`${API}/projects/${id}/secrets?env=development&values=true`)).json()) as { secrets: { key: string; value: string }[] }
    return r.secrets.find((x) => x.key === "ROTATION_PROOF")?.value
  }

  test("phase 1: owner, project and a secret under the first key; the card and the policy switches", async ({ browser }, info) => {
    const p = await ownerPage(browser, info, true)
    const made = await p.request.post(`${API}/projects`, { data: { name: "rotation proof" } })
    const id = ((await made.json()) as { id: string }).id
    const [dev] = ((await (await p.request.get(`${API}/projects/${id}/envs`)).json()) as { envs: { id: string }[] }).envs
    await p.request.post(`${API}/projects/${id}/secrets`, { data: { envId: dev.id, ops: [{ key: "ROTATION_PROOF", value: VALUE }] } })
    expect(await readValue(p)).toBe(VALUE)

    await p.goto("/admin/system/health")
    const card = p.getByRole("region", { name: "Secrets root key" })
    await expect(card).toBeVisible()
    await expect(card.getByText("Set", { exact: true })).toBeVisible()
    const fp = (await card.getByText(/^[0-9a-f]{16}$/).textContent())!
    await expect(card.getByText("In use for")).toBeVisible()
    await expect(card.getByText("Rotation under way")).toHaveCount(0)
    await card.getByText("Rotate the root key").click()
    await expect(card.getByText("SECRETS_ROOT_KEY_PREVIOUS").first()).toBeVisible()
    await card.getByRole("button", { name: "Make a new key" }).click()
    await expect(card.getByText(/^[A-Za-z0-9+/]{43}=$/)).toBeVisible()
    expect(db("select fingerprint from secret_root_key where id = 1")).toBe(fp)
    writeFileSync(state, JSON.stringify({ fp }))
    await p.setViewportSize({ width: 1440, height: 900 })
    await shotOf(p, "root-key")

    // The two Secrets switches are there and save.
    await p.goto("/admin/sharing/secrets")
    await expect(p.getByRole("checkbox", { name: "Scan uploaded files for leaked secrets" })).toBeChecked()
    await expect(p.getByRole("checkbox", { name: "Check passwords against Have I Been Pwned" })).toBeChecked()
    await p.getByRole("checkbox", { name: "Scan uploaded files for leaked secrets" }).uncheck()
    await p.getByRole("checkbox", { name: "Check passwords against Have I Been Pwned" }).uncheck()
    await p.getByRole("button", { name: "Save", exact: true }).first().click()
    await expect.poll(() => db("select secret_leak_scan || ',' || secret_hibp from settings")).toBe("false,false")
    await p.reload()
    await expect(p.getByRole("checkbox", { name: "Scan uploaded files for leaked secrets" })).not.toBeChecked()
    await p.getByRole("checkbox", { name: "Scan uploaded files for leaked secrets" }).check()
    await p.getByRole("checkbox", { name: "Check passwords against Have I Been Pwned" }).check()
    await p.getByRole("button", { name: "Save", exact: true }).first().click()
    await expect.poll(() => db("select secret_leak_scan || ',' || secret_hibp from settings")).toBe("true,true")
    await p.close()
  })

  test("phase 2: key B current, A previous: both open, Re-wrap runs and finishes", async ({ browser }, info) => {
    const p = await ownerPage(browser, info)
    // Everything still opens through the previous key.
    expect(await readValue(p)).toBe(VALUE)
    await p.goto("/admin/system/health")
    const card = p.getByRole("region", { name: "Secrets root key" })
    await expect(card.getByText("Rotation under way")).toBeVisible()
    const was = JSON.parse(readFileSync(state, "utf8")).fp as string
    await expect(card.getByText(new RegExp(`\\(${was}\\)`))).toBeVisible()
    await expect(card.getByText(/[1-9]\d* values? (is|are) still sealed/)).toBeVisible()
    await shotOf(p, "root-key-rotating")
    await card.getByRole("button", { name: "Re-wrap with the new key" }).click()
    await expect.poll(() => db("select count(*) from audit_events where action = 'secrets_root_rotate_start'")).toBe("1")
    // The worker would run it; forward the job as it does.
    const r = await p.request.post("/api/jobs", { headers: { authorization: `Bearer ${jobToken()}` }, data: { name: "secrets-rotate-root", data: {} } })
    expect(r.status()).toBe(204)
    await p.goto("/admin/system/health")
    await expect(card.getByText(/Everything is sealed with the new key/)).toBeVisible()
    await expect(card.getByText(/0 values are still sealed with it/)).toBeVisible()
    expect(db("select running || ',' || (done = total) || ',' || coalesce(error, '') from secret_root_key where id = 1")).toBe("false,true,")
    expect(db("select count(*) from audit_events where action = 'secrets_root_rewrap'")).toBe("1")
    // A second run has nothing left to do.
    expect((await p.request.post("/api/jobs", { headers: { authorization: `Bearer ${jobToken()}` }, data: { name: "secrets-rotate-root", data: {} } })).status()).toBe(204)
    expect(await readValue(p)).toBe(VALUE)
    await p.close()
  })

  test("phase 3: only key B: the project, its secret and the card are fine", async ({ browser }, info) => {
    const p = await ownerPage(browser, info)
    expect(await readValue(p)).toBe(VALUE)
    await p.goto("/admin/system/health")
    const card = p.getByRole("region", { name: "Secrets root key" })
    await expect(card.getByText("Set", { exact: true })).toBeVisible()
    await expect(card.getByText("Rotation under way")).toHaveCount(0)
    const was = JSON.parse(readFileSync(state, "utf8")).fp as string
    const now = (await card.getByText(/^[0-9a-f]{16}$/).textContent())!
    expect(now).not.toBe(was)
    await p.close()
  })
})
