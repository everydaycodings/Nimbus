import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"

// @ts-ignore plain JS fixture
import { startMock } from "./mock.mjs"

const CLI = new URL("../src/cli.ts", import.meta.url).pathname
let mock: any
let home: string
before(async () => {
  mock = await startMock()
  home = mkdtempSync(join(tmpdir(), "nimbus-cli-"))
})
after(() => mock.close())

const env = () => ({ ...process.env, NIMBUS_SERVER: mock.url, NIMBUS_TOKEN: "nms_test", NIMBUS_CONFIG_DIR: join(home, "cfg") })
const nimbus = (args: string[]) => spawn(process.execPath, [CLI, ...args], { env: env(), cwd: home })
// Async (not spawnSync): the mock server shares this event loop.
const exec = (args: string[], e: NodeJS.ProcessEnv = env()) =>
  new Promise<{ stdout: string; stderr: string; status: number | null }>((resolve) => {
    const c = spawn(process.execPath, [CLI, ...args], { env: e, cwd: home })
    let stdout = "", stderr = ""
    c.stdout.on("data", (d) => (stdout += d))
    c.stderr.on("data", (d) => (stderr += d))
    c.on("close", (status) => resolve({ stdout, stderr, status }))
  })
const sync = (args: string[]) => exec(args)
const E = ["--project=web", "--env=dev"]

test("run injects env and passes exit code", async () => {
  const r = await sync(["run", ...E, "--", "sh", "-c", 'echo "$DB_URL"; exit 7'])
  assert.equal(r.stdout.trim(), "postgres://u:p@h/db")
  assert.equal(r.status, 7)
})

test("export formats", async () => {
  const dot = (await sync(["export", ...E])).stdout
  assert.match(dot, /^DB_URL="postgres:\/\/u:p@h\/db"$/m)
  assert.ok(dot.includes('GREETING="hi \\"there\\"\\nline2 #x"'))
  const json = JSON.parse((await sync(["export", ...E, "--format=json"])).stdout)
  assert.equal(json.GREETING, 'hi "there"\nline2 #x')
  const yaml = (await sync(["export", ...E, "--format=yaml"])).stdout
  assert.ok(yaml.includes('DB_URL: "postgres://u:p@h/db"'))
})

test("secrets masks unless --plain", async () => {
  assert.doesNotMatch((await sync(["secrets", ...E])).stdout, /postgres/)
  assert.match((await sync(["secrets", ...E, "--plain"])).stdout, /postgres/)
})

test("locked gives exit 3, bad token exit 4", async () => {
  mock.state.locked = true
  const r = await sync(["secrets", ...E])
  mock.state.locked = false
  assert.equal(r.status, 3)
  assert.match(r.stderr, /unlock/i)
  const bad = await exec(["secrets", ...E], { ...env(), NIMBUS_TOKEN: "x" })
  assert.equal(bad.status, 4)
})

test("init writes .nimbus.json and run uses it", async () => {
  assert.equal((await sync(["init", "--project=web", "--env=dev"])).status, 0)
  assert.equal(JSON.parse(readFileSync(join(home, ".nimbus.json"), "utf8")).project, "web")
  assert.equal((await sync(["export"])).status, 0)
})

test("login stores token 0600, whoami, logout", async () => {
  const e = { ...process.env, NIMBUS_SERVER: mock.url, NIMBUS_CONFIG_DIR: join(home, "cfg2") }
  delete e.NIMBUS_TOKEN
  const run = (a: string[]) => exec(a, e)
  const l = await run(["login"])
  assert.match(l.stdout, /ABCD-1234/)
  assert.match(l.stdout, /Signed in as a@b.c/)
  const f = join(home, "cfg2", "config.json")
  assert.equal(statSync(f).mode & 0o777, 0o600)
  assert.match((await run(["whoami"])).stdout, /a@b.c/)
  await run(["logout"])
  assert.equal(JSON.parse(readFileSync(f, "utf8")).token, undefined)
})

test("agent rewrites atomically 0600 and runs hook only on change", async () => {
  const out = join(home, "app.env")
  const hook = join(home, "hook.log")
  const p = nimbus(["agent", ...E, `--out=${out}`, `--on-change=echo hit >> ${hook}`, "--interval=1"])
  const waitFor = async (fn: () => boolean) => {
    for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 100))
    assert.ok(fn())
  }
  const hits = () => { try { return readFileSync(hook, "utf8").split("\n").filter(Boolean).length } catch { return 0 } }
  await waitFor(() => hits() === 1)
  assert.equal(statSync(out).mode & 0o777, 0o600)
  await new Promise((r) => setTimeout(r, 2200)) // unchanged: no rewrite, no hook
  assert.equal(hits(), 1)
  mock.state.secrets.push({ key: "NEW", value: "v", type: "string", comment: "" })
  mock.state.version++
  await waitFor(() => hits() === 2)
  assert.match(readFileSync(out, "utf8"), /^NEW="v"$/m)
  p.kill()
})
