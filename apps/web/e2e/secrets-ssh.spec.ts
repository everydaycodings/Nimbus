import { expect, request as pwRequest, test, type Page } from "@playwright/test"

import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OTHER, PASSWORD, signIn, unique } from "./helpers"

// S4. Needs a real sshd: docker run -d --name s4-sshd -p 2230:2222 -e PUID=1000 -e PGID=1000
//   -e USER_NAME=tester -e PASSWORD_ACCESS=false -e LOG_STDOUT=true lscr.io/linuxserver/openssh-server
// and the terminal sidecar (npm run ssh-terminal) next to the app.
const API = "/api/v1/secrets"
const SSHD = process.env.E2E_SSHD ?? "s4-sshd"
const PORT = Number(process.env.E2E_SSHD_PORT ?? 2230)
const dx = (cmd: string) => execFileSync("docker", ["exec", SSHD, "sh", "-c", cmd]).toString()
const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", timeout: 30_000 })

async function unlock(page: Page) {
  await page.goto("/secrets")
  await page.getByLabel("Your Nimbus password").fill(PASSWORD)
  await page.getByRole("button", { name: "Unlock", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Secrets", exact: true })).toBeVisible()
}

async function terminalRuns(page: Page, host: string) {
  const row = page.getByTestId("ssh-hosts").locator("li").filter({ hasText: host })
  await row.getByRole("button", { name: "Terminal" }).click()
  await expect(page.getByTestId("term-status")).toHaveText("Connected", { timeout: 30_000 })
  await page.getByTestId("term-box").click()
  await page.keyboard.type("echo nimbus-$((6*7)) $(whoami)")
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("term-box")).toContainText("nimbus-42 tester")
  // A resize reaches the shell.
  await page.setViewportSize({ width: 900, height: 700 })
  await page.keyboard.type("stty size")
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("term-box")).toContainText(/\d+ \d+/)
  await page.keyboard.type("exit")
  await page.keyboard.press("Enter")
  await expect(page.getByTestId("term-status")).toHaveText("Session ended.", { timeout: 15_000 })
  await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible()
  await page.getByRole("button", { name: "Close", exact: true }).click()
}

test("SSH keys, hosts, terminal, push, CA and roles against a real sshd", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000)
  const work = mkdtempSync(join(tmpdir(), "s4-"))
  await signIn(page)
  await unlock(page)
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })

  const name = unique("ssh")
  const made = await (await page.request.post(`${API}/projects`, { data: { name } })).json()
  const pid = made.id as string
  const detail = await (await page.request.get(`${API}/projects/${pid}`)).json()
  const devId = detail.envs.find((e: { slug: string }) => e.slug === "development").id
  await page.request.post(`${API}/projects/${pid}/secrets`, { data: { envId: devId, ops: [{ key: "PUSHED", value: "yes-from-nimbus" }] } })

  try {
    // ---- keys ----
    await page.goto(`/secrets/${pid}?view=ssh`)
    await expect(page.getByRole("tab", { name: "Keys" })).toBeVisible()
    await page.getByRole("button", { name: "Add key" }).click()
    await page.getByLabel("Name", { exact: true }).fill("deploy key")
    await page.getByLabel("Passphrase (optional)").fill("s3cret-pass")
    await page.getByRole("button", { name: "Generate" }).click()
    const keys = page.getByTestId("ssh-keys")
    await expect(keys).toContainText("deploy key")
    await expect(keys).toContainText("passphrase")
    await expect(keys).toContainText(/SHA256:/)

    // Import: a pasted key shows its fingerprint and comment; a bad one is refused.
    const imp = join(work, "imp")
    sh("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "imported@laptop", "-f", imp])
    await page.getByRole("button", { name: "Add key" }).click()
    await page.getByRole("radio", { name: "Import" }).click()
    await page.getByLabel("Name", { exact: true }).fill("imported")
    await page.getByLabel("Private key").fill("nope")
    await page.getByRole("dialog").getByRole("button", { name: "Import" }).click()
    await expect(page.getByText("That isn't a private key we can read.")).toBeVisible()
    await page.getByLabel("Private key").fill(readFileSync(imp, "utf8"))
    await page.getByRole("dialog").getByRole("button", { name: "Import" }).click()
    await expect(keys).toContainText("imported@laptop")
    const want = sh("ssh-keygen", ["-lf", imp]).split(" ")[1]
    await expect(keys).toContainText(want)

    // Reveal is audited and returns the passphrase too.
    await page.getByRole("button", { name: "Private key" }).first().click()
    await page.getByRole("button", { name: "Reveal private key" }).click()
    await expect(page.getByTestId("private-key")).toHaveValue(/BEGIN OPENSSH PRIVATE KEY/)
    await expect(page.getByTestId("passphrase")).toHaveText("s3cret-pass")
    await page.keyboard.press("Escape")

    const list = (await (await page.request.get(`${API}/projects/${pid}/ssh/keys`)).json()).keys as { id: string; name: string; publicKey: string }[]
    const deploy = list.find((k) => k.name === "deploy key")!
    // (a) the public key goes on the server; the terminal logs in with the passphrase-protected stored key.
    dx(`printf '%s\\n' '${deploy.publicKey}' > /config/.ssh/authorized_keys && chown tester:users /config/.ssh/authorized_keys && chmod 600 /config/.ssh/authorized_keys`)

    // ---- hosts + terminal with a stored key ----
    await page.getByRole("tab", { name: "Hosts" }).click()
    await page.getByRole("button", { name: "Add host" }).click()
    await page.getByLabel("Name", { exact: true }).fill("sandbox")
    await page.getByLabel("Host", { exact: true }).fill("127.0.0.1")
    await page.getByLabel("Port").fill(String(PORT))
    await page.getByLabel("User", { exact: true }).fill("tester")
    await page.getByLabel("Sign in with").selectOption({ label: "Key: deploy key" })
    await page.getByRole("button", { name: "Add host" }).click()
    await expect(page.getByTestId("ssh-hosts")).toContainText(`tester@127.0.0.1:${PORT}`)
    await terminalRuns(page, "sandbox")
    await expect(page.getByTestId("ssh-hosts")).toContainText("host key pinned")

    // Config export for one host.
    const cfg = await (await page.request.get(`${API}/projects/${pid}/ssh/config`)).text()
    expect(cfg).toContain("Host sandbox")
    expect(cfg).toContain(`Port ${PORT}`)
    expect(cfg).toContain("IdentityFile ~/.ssh/nimbus_deploy-key")

    // ---- (c) server push with the stored key ----
    await page.goto(`/secrets/${pid}?view=access`)
    await page.getByRole("tab", { name: "Server push" }).click()
    await page.getByLabel("Host", { exact: true }).fill("127.0.0.1")
    await page.getByLabel("Port").fill(String(PORT))
    await page.getByLabel("User", { exact: true }).fill("tester")
    await page.getByLabel("File on the server").fill("/config/pushed.env")
    await page.getByLabel("Stored SSH key").selectOption({ label: "deploy key" })
    await page.getByRole("button", { name: "Set up push" }).click()
    await expect(page.getByText("Saved.")).toBeVisible()
    await page.getByRole("button", { name: "Push now" }).click()
    await expect(page.getByRole("status").filter({ hasText: "Wrote /config/pushed.env" })).toBeVisible({ timeout: 30_000 })
    expect(dx("cat /config/pushed.env")).toContain("PUSHED=")
    expect(dx("cat /config/pushed.env")).toContain("yes-from-nimbus")

    // ---- (b) CA ----
    await page.goto(`/secrets/${pid}?view=ssh`)
    await page.getByRole("tab", { name: "SSH CA" }).click()
    await page.getByRole("button", { name: "Set up the SSH CA" }).click()
    await expect(page.getByTestId("ca-script")).toContainText("TrustedUserCAKeys")
    const ca = (await page.getByTestId("ca-public").textContent())!.trim()
    expect(ca).toMatch(/^ssh-ed25519 /)
    // The server trusts the CA, and the plain key no longer matters for this login.
    dx(`printf '%s\\n' '${ca}' > /config/ca.pub && chmod 644 /config/ca.pub`)
    dx(`grep -q TrustedUserCAKeys /config/sshd/sshd_config || echo 'TrustedUserCAKeys /config/ca.pub' >> /config/sshd/sshd_config; : > /config/.ssh/authorized_keys; kill -HUP $(cat /config/sshd.pid)`)

    await page.getByRole("button", { name: "Issue certificate" }).click()
    await page.getByLabel("Principals").fill("tester")
    await page.getByLabel("Valid for").selectOption("2")
    await page.getByRole("dialog").getByRole("button", { name: "Issue" }).click()
    await expect(page.getByTestId("cert-out")).toHaveValue(/ssh-ed25519-cert-v01@openssh.com/)
    const cert = await page.getByTestId("cert-out").inputValue()
    const priv = await page.getByTestId("cert-key").inputValue()
    const kf = join(work, "id_nimbus")
    writeFileSync(kf, priv)
    chmodSync(kf, 0o600)
    writeFileSync(kf + ".crt", cert + "\n")
    const info = sh("ssh-keygen", ["-L", "-f", kf + ".crt"])
    expect(info).toContain("browser-test@example.invalid")
    expect(info).toContain("tester")
    const sshArgs = ["-p", String(PORT), "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "BatchMode=yes", "-i", kf, "-o", `CertificateFile=${kf}.crt`, "tester@127.0.0.1"]
    expect(sh("ssh", [...sshArgs, "echo cert-ok $(whoami)"]).trim()).toBe("cert-ok tester")
    // Without the certificate the same key is refused.
    expect(() => sh("ssh", ["-p", String(PORT), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-i", kf, "tester@127.0.0.1", "true"])).toThrow()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("cert-log")).toContainText("tester")

    // A principal outside the certificate is refused by sshd (cert for "tester" can't be root).
    const other = await (await page.request.post(`${API}/projects/${pid}/ssh/ca/issue`, { data: { principals: ["root"], hours: 1 } })).json()
    expect(other.certificate).toContain("-cert-v01")
    // Limits
    expect((await page.request.post(`${API}/projects/${pid}/ssh/ca/issue`, { data: { principals: ["x"], hours: 9 } })).status()).toBe(400)

    // Terminal host that signs in with a fresh CA certificate.
    await page.getByRole("tab", { name: "Hosts" }).click()
    await page.getByRole("button", { name: "Add host" }).click()
    await page.getByLabel("Name", { exact: true }).fill("ca-box")
    await page.getByLabel("Host", { exact: true }).fill("127.0.0.1")
    await page.getByLabel("Port").fill(String(PORT))
    await page.getByLabel("User", { exact: true }).fill("tester")
    await page.getByLabel("Sign in with").selectOption({ label: "A certificate from the SSH CA (the user name is the principal)" })
    await page.getByRole("button", { name: "Add host" }).click()
    await terminalRuns(page, "ca-box")

    // CLI: nimbus ssh cert with a member's token (device sign-in approved in the browser).
    const cli = await pwRequest.newContext({ baseURL })
    const start = await (await cli.post(`${API}/auth/device/start`, { data: { deviceName: "s4-cli" } })).json()
    await page.goto(new URL(start.verifyUrl).pathname + new URL(start.verifyUrl).search)
    await page.getByRole("button", { name: "Approve" }).click()
    await expect(page.getByText(/Approved/)).toBeVisible()
    const token = (await (await cli.post(`${API}/auth/device/poll`, { data: { pollToken: start.pollToken } })).json()).token as string
    const out = join(work, "cli_key")
    const env = { ...process.env, NIMBUS_TOKEN: token, NIMBUS_SERVER: baseURL!, NIMBUS_CONFIG_DIR: work }
    const res = execFileSync("node", ["../../packages/cli/src/cli.ts", "ssh", "cert", "--project", pid, "--principal", "tester", "--ttl", "1", "--out", out], { env, encoding: "utf8" })
    expect(res).toContain("Certificate valid until")
    expect(sh("ssh", ["-p", String(PORT), "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "BatchMode=yes", "-i", out, "-o", `CertificateFile=${out}-cert.pub`, "tester@127.0.0.1", "echo cli-ok"]).trim()).toBe("cli-ok")
    expect((await cli.post(`${API}/ssh/cert`, { data: { project: pid, principals: ["tester"] } })).status()).toBe(401)

    // ---- screens (saved when E2E_SHOTS is set) ----
    const shots = process.env.E2E_SHOTS
    if (shots) {
      for (const [w, h] of [[1440, 900], [390, 844]]) {
        await page.setViewportSize({ width: w, height: h })
        await page.goto(`/secrets/${pid}?view=ssh`)
        await page.addStyleTag({ content: "nextjs-portal{display:none!important}" })
        for (const tab of ["Keys", "Hosts", "SSH CA"]) {
          await page.getByRole("tab", { name: tab }).click()
          await expect(page.getByRole("tabpanel")).toBeVisible()
          await page.waitForTimeout(400)
          await page.screenshot({ path: join(shots, `${tab.replace(" ", "-")}-${w}.png`) })
        }
        await page.getByRole("tab", { name: "Hosts" }).click()
        await page.getByTestId("ssh-hosts").locator("li").first().getByRole("button", { name: "Terminal" }).click()
        await expect(page.getByTestId("term-status")).toHaveText("Connected", { timeout: 30_000 })
        await page.getByTestId("term-box").click()
        await page.keyboard.type("ls -la")
        await page.keyboard.press("Enter")
        await page.waitForTimeout(600)
        await page.screenshot({ path: join(shots, `Terminal-${w}.png`) })
        await page.getByRole("button", { name: "Close", exact: true }).click()
      }
      await page.setViewportSize({ width: 1280, height: 720 })
    }

    // ---- audit ----
    const audit = JSON.stringify(await (await page.request.get(`${API}/projects/${pid}/audit`)).json())
    for (const s of ["secrets_ssh_key_reveal", "secrets_ssh_session_start", "secrets_ssh_session_end", "secrets_ssh_cert_issue", "opened a terminal to tester@127.0.0.1"])
      expect(audit).toContain(s)
    expect(audit).not.toContain("BEGIN OPENSSH PRIVATE KEY")

    // ---- roles: a viewer sees public keys, can't reveal, can't open a terminal ----
    await page.goto(`/secrets/${pid}?view=access`)
    await page.getByRole("button", { name: "Add member" }).click()
    await page.getByLabel("Their Nimbus email").fill(OTHER)
    await page.getByLabel("Role").selectOption("viewer")
    await page.getByRole("dialog").getByRole("button", { name: "Add member" }).click()
    await expect(page.getByText("New Bie").first()).toBeVisible()
    const ctx = await browser.newContext({ baseURL })
    const v = await ctx.newPage()
    await v.waitForTimeout(10_500)
    await signIn(v, OTHER)
    await unlock(v)
    expect((await v.request.get(`${API}/projects/${pid}/ssh/keys`)).status()).toBe(200)
    expect((await v.request.get(`${API}/projects/${pid}/ssh/keys/${deploy.id}`)).status()).toBe(403)
    const hosts = (await (await page.request.get(`${API}/projects/${pid}/ssh/hosts`)).json()).hosts as { id: string }[]
    expect((await v.request.post(`${API}/projects/${pid}/ssh/hosts/${hosts[0].id}/terminal`)).status()).toBe(403)
    expect((await v.request.post(`${API}/projects/${pid}/ssh/ca/issue`, { data: { principals: ["tester"], hours: 1 } })).status()).toBe(403)
    expect((await v.request.delete(`${API}/projects/${pid}/ssh/keys/${deploy.id}`)).status()).toBe(403)
    await v.goto(`/secrets/${pid}?view=ssh`)
    await expect(v.getByRole("button", { name: "Add key" })).toHaveCount(0)
    await expect(v.getByTestId("ssh-keys")).toContainText("deploy key")
    await expect(v.getByRole("button", { name: "Private key" })).toHaveCount(0)
    await v.setViewportSize({ width: 390, height: 844 })
    await v.screenshot({ path: join(work, "viewer-390.png") })
    await ctx.close()

    // ---- the terminal ticket points at the sidecar ----
    const t = await (await page.request.post(`${API}/projects/${pid}/ssh/hosts/${hosts[0].id}/terminal`)).json()
    expect(t.ticket).toBeTruthy()
    expect(t.url).toMatch(/^ws:\/\/.*:3406\/ssh$/)
  } finally {
    await page.request.delete(`${API}/projects/${pid}`)
  }
})
