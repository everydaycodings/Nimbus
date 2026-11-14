// The three CLIs agree byte for byte, never run a value, keep trailing newlines, send a
// saved token only to its own server, and print one period in the 401 message.
// NIMBUS_CLI_BIN=<path> swaps the Node CLI for the Go binary; nimbus.sh runs every time.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

// @ts-ignore plain JS fixture
import { startMock } from "./mock.mjs"

const CLI = new URL("../src/cli.ts", import.meta.url).pathname
const SH = new URL("../nimbus.sh", import.meta.url).pathname
const BIN = process.env.NIMBUS_CLI_BIN
const clis: [string, (a: string[]) => [string, string[]]][] = [
  [BIN ? "go" : "node", (a) => (BIN ? [BIN, a] : [process.execPath, [CLI, ...a]])],
  ["sh", (a) => ["bash", [SH, ...a]]],
]

let mock: any
let home: string
// Answers 401 with a message that ends in a period, and records what it was sent.
const seen: (string | undefined)[] = []
const other = createServer((req, res) => {
  seen.push(req.headers.authorization)
  res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: "unauthorized", message: "Invalid or expired token." } }))
})
let otherUrl = ""
before(async () => {
  mock = await startMock()
  mock.state.secrets = [
    { key: "a", value: "lower", type: "string", comment: "" },
    { key: "AB", value: "2", type: "string", comment: "" },
    { key: "A_B", value: "1", type: "string", comment: "" },
    { key: "EVIL", value: "$(touch pwned) `touch pwned2` ${HOME}", type: "string", comment: "" },
    { key: "PEM", value: "-----BEGIN X-----\nabc\n-----END X-----\n", type: "pem", comment: "" },
  ]
  await new Promise<void>((r) => other.listen(0, "127.0.0.1", () => r()))
  otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}`
  home = mkdtempSync(join(tmpdir(), "nimbus-r3-"))
})
after(() => {
  mock.close()
  other.close()
})

const exec = (which: (a: string[]) => [string, string[]], args: string[], env: NodeJS.ProcessEnv, cwd = home) =>
  new Promise<{ stdout: string; stderr: string; status: number | null }>((resolve) => {
    const c = spawn(...which(args), { env, cwd })
    let stdout = "", stderr = ""
    c.stdout.on("data", (d) => (stdout += d))
    c.stderr.on("data", (d) => (stderr += d))
    c.on("close", (status) => resolve({ stdout, stderr, status }))
  })
const env = () => ({ ...process.env, NIMBUS_SERVER: mock.url, NIMBUS_TOKEN: "nms_test", NIMBUS_CONFIG_DIR: join(home, "cfg") })
const E = ["--project=web", "--env=dev"]

const EXPECTED =
  'AB="2"\nA_B="1"\nEVIL="\\$(touch pwned) \\`touch pwned2\\` \\${HOME}"\nPEM="-----BEGIN X-----\\nabc\\n-----END X-----\\n"\na="lower"\n'

for (const [name, which] of clis) {
  test(`${name}: dotenv is code-point sorted, escaped, and safe to source`, async () => {
    const r = await exec(which, ["export", ...E], env())
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout, EXPECTED)
    const f = join(home, `${name}.env`)
    writeFileSync(f, r.stdout)
    const sourced = await exec(() => ["bash", ["-c", `set -a; . "${f}"; printf %s "$EVIL"`]], [], env())
    assert.equal(sourced.stdout, mock.state.secrets[3].value)
    assert.ok(!existsSync(join(home, "pwned")) && !existsSync(join(home, "pwned2")))
  })

  test(`${name}: run keeps a value's trailing newline`, async () => {
    const r = await exec(which, ["run", ...E, "--", process.execPath, "-e", "process.stdout.write(JSON.stringify(process.env.PEM))"], env())
    assert.equal(JSON.parse(r.stdout), mock.state.secrets[4].value)
  })

  test(`${name}: agent writes 0600 through a fresh temp file`, async () => {
    const dir = join(home, `agent-${name}`)
    mkdirSync(dir)
    const out = join(dir, "app.env")
    const r = await exec(which, ["agent", ...E, `--out=${out}`, "--once"], env())
    assert.equal(r.status, 0, r.stderr)
    assert.equal(readFileSync(out, "utf8"), EXPECTED)
    assert.equal(statSync(out).mode & 0o777, 0o600)
    assert.deepEqual(readdirSync(dir), ["app.env"])
  })

  test(`${name}: a saved token never goes to another server, and 401 reads cleanly`, async () => {
    const cfg = join(home, `cfg-${name}`)
    mkdirSync(cfg)
    writeFileSync(join(cfg, "config.json"), JSON.stringify({ server: mock.url, token: "nms_test" }))
    const repo = join(home, `repo-${name}`)
    mkdirSync(repo)
    writeFileSync(join(repo, ".nimbus.json"), JSON.stringify({ project: "web", env: "dev", server: otherUrl }))
    const e = { ...process.env, NIMBUS_CONFIG_DIR: cfg }
    delete e.NIMBUS_TOKEN
    delete e.NIMBUS_SERVER
    seen.length = 0
    const r = await exec(which, ["export"], e, repo)
    assert.equal(r.status, 4)
    assert.deepEqual(seen.filter(Boolean), [])
    // Its own server still gets it (the repo's file names no server here).
    writeFileSync(join(repo, ".nimbus.json"), JSON.stringify({ project: "web", env: "dev" }))
    assert.equal((await exec(which, ["export"], e, repo)).status, 0)

    const bad = await exec(which, ["export", ...E], { ...env(), NIMBUS_SERVER: otherUrl, NIMBUS_TOKEN: "x" })
    assert.equal(bad.status, 4)
    assert.match(bad.stderr, /Unauthorized: Invalid or expired token\. Run `nimbus login`\./)
    assert.doesNotMatch(bad.stderr, /\.\./)
  })
}
