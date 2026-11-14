import { expect, request as pwRequest, test, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import tls from "node:tls"

import { totp } from "../lib/secrets/totp"
import { PASSWORD, signIn, unique } from "./helpers"

// S5: certificate store, private CA, domain watch, typed items; ACME against Pebble.
// Needs SECRETS_ROOT_KEY on the server, Secrets on, and openssl. The ACME test also
// needs Pebble (see the comment above it) and runs only with E2E_PEBBLE=1.
const API = "/api/v1/secrets"
const dir = mkdtempSync(join(tmpdir(), "s5-"))
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: "pipe" }).toString()
const db = (q: string) =>
  execFileSync("psql", [process.env.DATABASE_URL ?? "postgres://nimbus:nimbus@localhost:5432/nimbus", "-qAtc", q]).toString().trim()

async function unlock(page: Page) {
  await page.goto("/secrets")
  await page.getByLabel("Your Nimbus password").fill(PASSWORD)
  await page.getByRole("button", { name: "Unlock", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible()
}

async function sweep(page: Page) {
  const token = execFileSync("node", ["--env-file=.env.local", "--input-type=module", "-e", "import {signToken} from './lib/upload-rules.ts'; console.log(signToken('job',{},60000))"]).toString().trim()
  const r = await page.request.post("/api/jobs", { headers: { authorization: `Bearer ${token}` }, data: { name: "secrets-sweep", data: {} } })
  expect(r.status()).toBe(204)
}

async function newProject(page: Page) {
  const made = await (await page.request.post(`${API}/projects`, { data: { name: unique("pki") } })).json()
  return made.id as string
}

// A self-signed certificate with its key, written to files.
function selfSigned(name: string, cn: string, days: number, san = `DNS:${cn}`) {
  const key = join(dir, `${name}.key`)
  const crt = join(dir, `${name}.crt`)
  sh("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", key, "-out", crt, "-subj", `/CN=${cn}`, "-addext", `subjectAltName=${san}`, "-days", String(days)])
  return { key, crt }
}

test("typed items: masked, copied, TOTP, DB URL, files, search by name only", async ({ page }) => {
  await signIn(page)
  await unlock(page)
  const id = await newProject(page)
  await page.goto(`/secrets/${id}?view=items`)
  await expect(page.getByRole("heading", { name: "Items", exact: true })).toBeVisible()
  await expect(page.getByText("No items yet")).toBeVisible()

  const secret = "JBSWY3DPEHPK3PXP"
  const add = async (type: string, name: string) => {
    await page.getByRole("button", { name: "New item" }).click()
    await page.getByRole("button", { name: type, exact: true }).click()
    await page.getByLabel("Name", { exact: true }).fill(name)
  }

  // Login with an otpauth link.
  await add("Login", "GitHub login")
  await page.getByLabel("Username").fill("octo")
  await page.getByLabel("Password", { exact: true }).fill("hunter2-pass")
  await page.getByLabel("TOTP secret").fill(`otpauth://totp/GitHub:octo?secret=${secret}&issuer=GitHub&digits=6&period=30`)
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await page.getByRole("button", { name: /GitHub login/ }).click()
  const dlg = page.getByRole("dialog")
  await expect(dlg.getByText("hunter2-pass")).toHaveCount(0)
  await dlg.getByRole("button", { name: "Show Password" }).click()
  await expect(dlg.getByText("hunter2-pass")).toBeVisible()
  await dlg.getByRole("button", { name: "Copy Password" }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("hunter2-pass")
  // Live code, computed by the server without showing the secret.
  await dlg.getByRole("button", { name: "Show code" }).click()
  const code = (await dlg.getByText(/^\d{3} \d{3}$/).textContent())!.replace(" ", "")
  const now = Date.now()
  expect([totp(secret, now).code, totp(secret, now - 30_000).code, totp(secret, now + 30_000).code]).toContain(code)
  await expect(dlg.getByLabel(/seconds left/)).toBeVisible()
  await expect(dlg.getByText(secret)).toHaveCount(0)
  await page.keyboard.press("Escape")

  // API key with an expiry tomorrow, DB connection, note.
  await add("API key", "Stripe live key")
  await page.getByLabel("Key or token").fill("sk_live_abc123")
  await page.getByLabel("Provider").fill("Stripe")
  const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10)
  await page.getByLabel("Expires").fill(tomorrow)
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByRole("button", { name: /Stripe live key/ })).toBeVisible()

  await add("Database", "Orders DB")
  await page.getByLabel("Host").fill("db.internal")
  await page.getByLabel("Port").fill("5432")
  await page.getByLabel("Database", { exact: true }).fill("orders")
  await page.getByLabel("Username").fill("app user")
  await page.getByLabel("Password", { exact: true }).fill("p@ss/w:rd")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await page.getByRole("button", { name: /Orders DB/ }).click()
  await page.getByRole("button", { name: "Copy as URL" }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("postgres://app%20user:p%40ss%2Fw%3Ard@db.internal:5432/orders")
  await page.keyboard.press("Escape")

  await add("Secure note", "Wifi note")
  await page.getByLabel("Note", { exact: true }).fill("the wifi password is zebra-mango-17")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByRole("button", { name: /Wifi note/ })).toBeVisible()

  // A small file: stored sealed, downloads back byte for byte; 1 MB is the limit.
  await add("File", "Deploy key file")
  await page.getByLabel("File", { exact: true }).setInputFiles({ name: "deploy.txt", mimeType: "text/plain", buffer: Buffer.from("file-body-123") })
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await page.getByRole("button", { name: /Deploy key file/ }).click()
  const dl = page.waitForEvent("download")
  await page.getByRole("link", { name: "Download" }).click()
  const d = await dl
  expect(d.suggestedFilename()).toBe("deploy.txt")
  expect(readFileSync((await d.path())!, "utf8")).toBe("file-body-123")
  await page.keyboard.press("Escape")
  const big = await page.request.post(`${API}/projects/${id}/items`, { data: { kind: "file", name: "big", data: { filename: "b", content: Buffer.alloc(1024 * 1024 + 1).toString("base64") } } })
  expect(big.status()).toBe(400)

  // Everything is sealed in the database; only names are plain.
  const raw = db(`select name || ' ' || kind || ' ' || data_enc from secret_items where project_id = '${id}'`)
  for (const s of ["hunter2-pass", "sk_live_abc123", "db.internal", "zebra-mango", "file-body", secret]) expect(raw).not.toContain(s)

  // Search finds names, never what's inside.
  await page.getByPlaceholder("Search keys, comments, tags").fill("Orders")
  await expect(page.getByText("Certificates and items, by name")).toBeVisible()
  await expect(page.getByRole("button", { name: /Orders DB/ })).toBeVisible()
  await page.getByPlaceholder("Search keys, comments, tags").fill("zebra-mango")
  await expect(page.getByText(/Nothing matches/)).toBeVisible()
  await expect(page.getByRole("button", { name: /Wifi note/ })).toHaveCount(0)

  // Opening and copying are in the audit log.
  const audit = await (await page.request.get(`${API}/projects/${id}/audit`)).json()
  const actions = new Set((audit.rows as { action: string }[]).map((r) => r.action))
  for (const a of ["secrets_item_create", "secrets_item_reveal", "secrets_item_copy", "secrets_item_totp", "secrets_item_download"]) expect(actions.has(a)).toBe(true)

  // Expiry notice from the sweep.
  await sweep(page)
  const notes = JSON.stringify((await (await page.request.get("/api/v1/notifications")).json()).items)
  expect(notes).toContain("The API key “Stripe live key” expires in a day")

  // A viewer can list but not open.
  const viewer = await page.request.get(`${API}/projects/${id}/items`)
  expect(viewer.status()).toBe(200)
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto(`/secrets/${id}?view=items`)
  await expect(page.getByRole("button", { name: /Orders DB/ })).toBeVisible()
  await page.screenshot({ path: join(dir, "items-390.png") })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.reload()
  await page.screenshot({ path: join(dir, "items-1440.png") })
})

test("certificates: upload, parse, downloads, private CA, CRL, watch, notices", async ({ page, baseURL }) => {
  await signIn(page)
  await unlock(page)
  const id = await newProject(page)
  await page.goto(`/secrets/${id}?view=certs`)
  await expect(page.getByRole("heading", { name: "Certificates", exact: true })).toBeVisible()
  await expect(page.getByText("No certificates yet")).toBeVisible()

  // Upload a PEM certificate and its key as two files.
  const a = selfSigned("a", "shop.example.test", 20, "DNS:shop.example.test,DNS:www.shop.example.test,IP:10.1.2.3")
  await page.getByRole("button", { name: "Upload", exact: true }).click()
  await page.getByLabel("Certificate files").setInputFiles([a.crt, a.key])
  await page.getByLabel("Name", { exact: true }).fill("Shop cert")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await page.getByRole("button", { name: /Shop cert/ }).click()
  const dlg = page.getByRole("dialog")
  await expect(dlg.getByText("DNS:shop.example.test, DNS:www.shop.example.test, IP:10.1.2.3")).toBeVisible()
  await expect(dlg.getByText("CN=shop.example.test").first()).toBeVisible()
  await expect(dlg.getByText("Stored, matches the certificate")).toBeVisible()
  await expect(dlg.getByText(/EC prime256v1/)).toBeVisible()
  await expect(dlg.getByText("20 days left").or(dlg.getByText("19 days left"))).toBeVisible()

  // Downloads: PEM, key, PFX (read back with openssl).
  const save = async (name: string | RegExp) => {
    const dl = page.waitForEvent("download")
    await dlg.getByRole("button", { name }).click()
    return dl
  }
  const pem = await save("Full chain (PEM)")
  expect(readFileSync((await pem.path())!, "utf8")).toContain("BEGIN CERTIFICATE")
  const key = await save("Private key")
  expect(readFileSync((await key.path())!, "utf8")).toContain("BEGIN PRIVATE KEY")
  await dlg.getByRole("button", { name: "PFX" }).click()
  await page.getByLabel("PFX password").fill("pfx-pass-1")
  const dlp = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download", exact: true }).click()
  const pfxFile = join(dir, "got.pfx")
  await (await dlp).saveAs(pfxFile)
  expect(sh("openssl", ["pkcs12", "-in", pfxFile, "-passin", "pass:pfx-pass-1", "-nokeys", "-clcerts"])).toContain("BEGIN CERTIFICATE")
  await page.keyboard.press("Escape")

  // A key that doesn't belong is refused; a password-protected PFX opens with its password.
  const other = selfSigned("b", "other.example.test", 400)
  await page.getByRole("button", { name: "Upload", exact: true }).click()
  await page.getByLabel("Certificate files").setInputFiles([a.crt, other.key])
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByText("That private key doesn't belong to the certificate.")).toBeVisible()
  await page.getByRole("button", { name: "Cancel" }).click()
  const pfxIn = join(dir, "b.pfx")
  sh("openssl", ["pkcs12", "-export", "-inkey", other.key, "-in", other.crt, "-out", pfxIn, "-passout", "pass:in-pass"])
  await page.getByRole("button", { name: "Upload", exact: true }).click()
  await page.getByLabel("Certificate files").setInputFiles([pfxIn])
  await page.getByLabel("Password (PFX or encrypted key)").fill("wrong")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByText("The PFX password is wrong.")).toBeVisible()
  await page.getByLabel("Password (PFX or encrypted key)").fill("in-pass")
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await expect(page.getByRole("button", { name: /other.example.test/ })).toBeVisible()

  // Private CA: root, intermediate, template, issue, chain.
  await page.getByRole("tab", { name: "Private CA" }).click()
  await page.getByRole("button", { name: "New CA" }).click()
  await page.getByLabel("Name", { exact: true }).fill("Root CA")
  await page.getByLabel("Common name").fill("Nimbus Test Root")
  await page.getByRole("button", { name: "Create", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Root CA" })).toBeVisible()
  await page.getByRole("button", { name: "New CA" }).click()
  await page.getByLabel("Name", { exact: true }).fill("Inter CA")
  await page.getByLabel("Common name").fill("Nimbus Test Intermediate")
  await page.getByLabel("Signed by").selectOption({ label: "Root CA" })
  await page.getByRole("button", { name: "Create", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Inter CA" })).toBeVisible()
  const inter = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Inter CA" }) })
  await inter.getByRole("button", { name: "Add template" }).click()
  await page.getByLabel("Name", { exact: true }).fill("Internal servers")
  await page.getByLabel("Longest lifetime (days)").fill("60")
  await page.getByLabel("Allowed names").fill("*.internal.example.test")
  await page.getByRole("button", { name: "Add template" }).last().click()
  await expect(inter.getByText(/Internal servers/)).toBeVisible()
  await inter.getByRole("button", { name: "Issue certificate" }).click()
  await page.getByLabel("Common name").fill("evil.example.com")
  await page.getByRole("button", { name: "Issue", exact: true }).click()
  await expect(page.getByText(/isn't allowed by the template/)).toBeVisible()
  await page.getByLabel("Common name").fill("api.internal.example.test")
  await page.getByLabel("Lifetime (days)").fill("30")
  await page.getByRole("button", { name: "Issue", exact: true }).click()
  await expect(page.getByText("Issued. It's in the Store.")).toBeVisible()

  const cas0 = (await (await page.request.get(`${API}/projects/${id}/cas`)).json()).cas as { id: string; name: string; templates: { id: string }[] }[]
  const tooLong = await page.request.post(`${API}/projects/${id}/cas/${cas0.find((c) => c.name === "Inter CA")!.id}/issue`, { data: { templateId: cas0.find((c) => c.name === "Inter CA")!.templates[0].id, cn: "x.internal.example.test", ttlDays: 90 } })
  expect((await tooLong.json()).message).toBe("This template allows at most 60 days.")

  // The CA chain verifies the issued certificate with openssl.
  const caList = (await (await page.request.get(`${API}/projects/${id}/cas`)).json()).cas as { id: string; name: string; crlUrl: string }[]
  const interCa = caList.find((c) => c.name === "Inter CA")!
  const chain = await page.request.get(`${API}/projects/${id}/cas/${interCa.id}/chain`)
  expect(chain.headers()["content-disposition"]).toContain("Inter_CA-chain.pem")
  writeFileSync(join(dir, "chain.pem"), await chain.text())
  const certs = (await (await page.request.get(`${API}/projects/${id}/certs`)).json()).certs as { id: string; name: string; serial: string; source: string }[]
  const issued = certs.find((c) => c.source === "ca")!
  expect(issued.name).toBe("api.internal.example.test")
  const full = await page.request.post(`${API}/projects/${id}/certs/${issued.id}/download`, { data: { format: "cert" } })
  writeFileSync(join(dir, "leaf.pem"), await full.text())
  const chainText = readFileSync(join(dir, "chain.pem"), "utf8")
  const [interPem, rootPem] = chainText.split(/(?<=-----END CERTIFICATE-----\n)/).filter(Boolean)
  writeFileSync(join(dir, "root.pem"), rootPem)
  writeFileSync(join(dir, "inter.pem"), interPem)
  expect(sh("openssl", ["verify", "-CAfile", join(dir, "root.pem"), "-untrusted", join(dir, "inter.pem"), join(dir, "leaf.pem")])).toContain("OK")

  // Revoke it from the Store; the public CRL (no sign-in) lists the serial and is signed by the CA.
  await page.getByRole("tab", { name: "Store" }).click()
  await page.getByRole("button", { name: /api.internal.example.test/ }).click()
  await page.getByRole("button", { name: "Revoke", exact: true }).click()
  await page.getByLabel("Reason").selectOption("1")
  await page.getByRole("dialog").last().getByRole("button", { name: "Revoke", exact: true }).click()
  await expect(page.getByText("Revoked", { exact: true }).first()).toBeVisible()
  await page.keyboard.press("Escape")
  const anon = await pwRequest.newContext({ baseURL })
  const crl = await anon.get(new URL(interCa.crlUrl).pathname)
  expect(crl.status()).toBe(200)
  writeFileSync(join(dir, "i.crl"), await crl.body())
  const text = sh("openssl", ["crl", "-inform", "DER", "-in", join(dir, "i.crl"), "-noout", "-text"])
  expect(text.toUpperCase()).toContain(issued.serial.toUpperCase())
  sh("openssl", ["crl", "-inform", "DER", "-in", join(dir, "i.crl"), "-noout", "-CAfile", join(dir, "inter.pem")])
  expect((await anon.get("/pki/crl/not-an-id.crl")).status()).toBe(404)
  await anon.dispose()

  // Domain watch against a local TLS server: shows expiry and issuer, then the failure once it's gone.
  const watched = selfSigned("w", "localhost", 25, "DNS:localhost")
  const srv = tls.createServer({ cert: readFileSync(watched.crt), key: readFileSync(watched.key) }, (s) => s.end())
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r))
  const port = (srv.address() as { port: number }).port
  await page.getByRole("tab", { name: "Domain watch" }).click()
  // Private addresses are refused unless an admin allows them (SSRF guard); only project admins can add.
  db("update settings set secret_allow_private = false")
  for (const bad of ["169.254.169.254", "127.0.0.1", "localhost"]) {
    const r = await page.request.post(`${API}/projects/${id}/watches`, { data: { host: bad, port: 443 } })
    expect(r.status(), bad).toBe(422)
    expect((await r.json()).message).toMatch(/private/)
  }
  db("update settings set secret_allow_private = true")
  await page.getByLabel("Host", { exact: true }).fill("127.0.0.1")
  await page.getByLabel("Port").fill(String(port))
  await page.getByRole("button", { name: "Watch" }).click()
  const row = page.getByRole("listitem").filter({ hasText: `127.0.0.1:${port}` })
  await expect(row.getByText("CN=localhost")).toBeVisible()
  await expect(row.getByText(/2[45] days left/)).toBeVisible()
  await sweep(page) // 25 days is inside 30: one warning each for the watch and the uploaded 20-day certificate
  const notes = JSON.stringify((await (await page.request.get("/api/v1/notifications")).json()).items)
  expect(notes).toContain(`The certificate served by 127.0.0.1:${port} expires in 30 days`)
  expect(notes).toContain("The certificate “Shop cert” expires in 30 days")
  expect(notes).not.toContain("“other.example.test”")
  srv.close()
  await row.getByRole("button", { name: /Check 127.0.0.1 now/ }).click()
  await expect(row.getByText("Connection refused.")).toBeVisible()

  // A short certificate warns at 7 days then 1 day, once each.
  const soon = selfSigned("c", "soon.example.test", 3)
  const count = async () => JSON.stringify((await (await page.request.get("/api/v1/notifications")).json()).items).split("The certificate “Soon cert” expires in 7 days").length - 1
  const was = await count()
  const up = await page.request.post(`${API}/projects/${id}/certs`, { data: { name: "Soon cert", files: [readFileSync(soon.crt).toString("base64")] } })
  expect(up.status()).toBe(200)
  await sweep(page)
  await sweep(page)
  expect((await count()) - was).toBe(1)

  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto(`/secrets/${id}?view=certs`)
  await expect(page.getByRole("button", { name: /Shop cert/ })).toBeVisible()
  await page.screenshot({ path: join(dir, "certs-390.png") })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole("tab", { name: "Private CA" }).click()
  await page.screenshot({ path: join(dir, "ca-1440.png") })
  db("update settings set secret_allow_private = false")
  console.log("screenshots in", dir)
})

// ACME against Pebble. Start it with (host network so it reaches this server and the challenge server):
//   docker run -d --name s5-challtest --network host ghcr.io/letsencrypt/pebble-challtestsrv -http01 "" -https01 "" -tlsalpn01 ""
//   docker run -d --name s5-pebble --network host -e PEBBLE_VA_NOSLEEP=1 -v <pebble-config.json>:/cfg.json \
//     ghcr.io/letsencrypt/pebble -config /cfg.json -dnsserver 127.0.0.1:8053     (config: httpPort 3000, listenAddress 0.0.0.0:14000)
// and start the app with ACME_ALLOW_CUSTOM_DIRECTORY=1 NODE_TLS_REJECT_UNAUTHORIZED=0 ACME_DNS_WAIT_SECONDS=0
// ACME_DNS_RESOLVER=127.0.0.1:8053 ACME_DNS_API_BASE=http://127.0.0.1:18055.
test("ACME: HTTP-01, DNS-01 through a Cloudflare fake, and a manual TXT, against Pebble", async ({ page }) => {
  test.skip(!process.env.E2E_PEBBLE, "needs Pebble (E2E_PEBBLE=1)")
  test.setTimeout(180_000)
  const CHALL = "http://127.0.0.1:8055"
  const post = (p: string, body: object) => fetch(`${CHALL}${p}`, { method: "POST", body: JSON.stringify(body) })
  await post("/add-a", { host: "web.example.com", addresses: ["127.0.0.1"] })

  // A fake Cloudflare: zone lookup, then TXT records forwarded to Pebble's challenge DNS.
  const cf = createServer(async (req, res) => {
    let body = ""
    for await (const c of req) body += c
    const u = new URL(req.url!, "http://x")
    const json = (o: object) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o))
    expect(req.headers.authorization).toBe("Bearer cf-test-token")
    if (u.pathname === "/zones") return json({ result: u.searchParams.get("name") === "example.com" ? [{ id: "zone1" }] : [] })
    if (req.method === "POST") {
      const r = JSON.parse(body)
      await post("/set-txt", { host: `${r.name}.`, value: r.content })
      return json({ result: { id: Buffer.from(`${r.name}|${r.content}`).toString("base64url") } })
    }
    const [name] = Buffer.from(u.pathname.split("/").pop()!, "base64url").toString().split("|")
    await post("/clear-txt", { host: `${name}.` })
    json({})
  })
  await new Promise<void>((r) => cf.listen(18055, "127.0.0.1", r))

  await signIn(page)
  await unlock(page)
  const id = await newProject(page)
  await page.goto(`/secrets/${id}?view=certs`)
  await page.getByRole("tab", { name: "Let's Encrypt" }).click()
  await page.getByRole("button", { name: "Add account" }).click()
  await page.getByLabel("Directory", { exact: true }).selectOption("custom")
  await page.getByLabel("Directory URL").fill("https://localhost:14000/dir")
  await page.getByLabel("Contact email").fill("ops@example.com")
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page.getByText("ops@example.com")).toBeVisible()

  const order = async (domains: string, name: string, challenge: string) => {
    await page.getByRole("button", { name: "Get a certificate" }).click()
    await page.getByLabel("Domain names").fill(domains)
    await page.getByLabel("Name in the Store").fill(name)
    await page.getByLabel("Prove ownership with").selectOption(challenge)
  }

  // HTTP-01: Pebble fetches the token from this server, on port 3000.
  await order("web.example.com", "Web via HTTP", "http-01")
  await page.getByRole("button", { name: "Start" }).click()
  await expect(page.getByText("Issued", { exact: true })).toBeVisible({ timeout: 90_000 })

  // DNS-01 with a wildcard through the Cloudflare fake.
  await page.getByRole("button", { name: "Add credential" }).click()
  await page.getByLabel("Name", { exact: true }).fill("Fake Cloudflare")
  await page.getByLabel("API token (Zone:DNS:Edit)").fill("cf-test-token")
  await page.getByRole("button", { name: "Save" }).click()
  await order("*.example.com", "Wildcard via DNS", "dns-01")
  await page.getByRole("button", { name: "Start" }).click()
  await expect(page.getByText("Issued", { exact: true })).toHaveCount(2, { timeout: 90_000 })

  // Manual TXT: shows the record, Verify refuses until it's visible, then issues.
  await order("manual.example.com", "Manual one", "manual")
  await page.getByRole("button", { name: "Start" }).click()
  await expect(page.getByText("Add the record, then verify")).toBeVisible({ timeout: 30_000 })
  const recName = (await page.getByText(/^_acme-challenge\.manual\.example\.com$/).textContent())!
  const recValue = (await page.locator("code").filter({ hasText: /^[A-Za-z0-9_-]{43}$/ }).first().textContent())!
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page.getByText(/Not visible in DNS yet/)).toBeVisible()
  await post("/set-txt", { host: `${recName}.`, value: recValue })
  await page.getByRole("button", { name: "Verify" }).click()
  await expect(page.getByText("Issued", { exact: true })).toHaveCount(3, { timeout: 90_000 })

  // All three are in the Store with their keys; auto-renew is on for the first two only.
  await page.getByRole("tab", { name: "Store" }).click()
  const certs = (await (await page.request.get(`${API}/projects/${id}/certs`)).json()).certs as { id: string; name: string; issuer: string; sans: string[]; hasKey: boolean; acme: { autoRenew: boolean } }[]
  expect(certs.map((c) => c.name).sort()).toEqual(["Manual one", "Web via HTTP", "Wildcard via DNS"])
  for (const c of certs) {
    expect(c.hasKey).toBe(true)
    expect(c.issuer).toContain("Pebble")
  }
  expect(certs.find((c) => c.name === "Wildcard via DNS")!.sans).toContain("DNS:*.example.com")
  expect(certs.map((c) => c.acme.autoRenew)).toEqual(expect.arrayContaining([true, false]))
  // Renewal: move the HTTP certificate's expiry inside 30 days; the sweep renews it in place.
  const http = certs.find((c) => c.name === "Web via HTTP")!
  const before = db(`select serial from secret_certs where id = '${http.id}'`)
  db(`update secret_certs set not_after = now() + interval '10 days' where id = '${http.id}'`)
  await sweep(page)
  expect(db(`select serial from secret_certs where id = '${http.id}'`)).not.toBe(before)
  expect(db(`select count(*) from secret_certs where id = '${http.id}' and not_after > now() + interval '30 days'`)).toBe("1")
  expect(JSON.stringify((await (await page.request.get("/api/v1/notifications")).json()).items)).toContain("Renewed the certificate “Web via HTTP”")
  cf.close()
})
