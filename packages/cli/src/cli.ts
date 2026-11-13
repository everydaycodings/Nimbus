#!/usr/bin/env node
import { spawn } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir, hostname, platform } from "node:os"
import { dirname, join } from "node:path"

type Secret = { key: string; value: string; type: string; comment: string }
type Config = { server?: string; token?: string }
type Project = { project?: string; env?: string; path?: string; server?: string }

class Fail extends Error {
  code: number
  constructor(msg: string, code = 1) {
    super(msg)
    this.code = code
  }
}

const HELP = `nimbus <command>
  login [--server URL]   logout   whoami
  init [--project P --env E --path /]
  secrets [--plain]      list secrets (masked unless --plain)
  run [--env E] [--path /] -- <cmd...>
  export [--format dotenv|json|yaml]
  agent --out FILE [--on-change CMD] [--interval SECONDS] [--format F] [--once]
  ssh cert --project P --principal deploy[,root] [--ttl HOURS] [--key PUBKEY_FILE] [--out FILE]
                         ask the project's SSH CA for a 1-8 hour certificate (no --key: new key pair)
Common: --project P --env E --path /   Env: NIMBUS_TOKEN NIMBUS_SERVER`

// ---- config -----------------------------------------------------------------
const configDir = () =>
  process.env.NIMBUS_CONFIG_DIR ||
  join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "nimbus")
const configFile = () => join(configDir(), "config.json")

function readJson<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T
  } catch {
    return {} as T
  }
}
function saveConfig(c: Config) {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  writeFileSync(configFile(), JSON.stringify(c, null, 2), { mode: 0o600 })
  chmodSync(configFile(), 0o600)
}
const projectFile = ".nimbus.json"

// ---- args -------------------------------------------------------------------
const BOOL = new Set(["plain", "once", "help"])
function parse(argv: string[]) {
  const flags: Record<string, string> = {}
  const pos: string[] = []
  let rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--") {
      rest = argv.slice(i + 1)
      break
    }
    if (!a.startsWith("--")) {
      pos.push(a)
      continue
    }
    const eq = a.indexOf("=")
    const name = a.slice(2, eq < 0 ? undefined : eq)
    if (eq >= 0) flags[name] = a.slice(eq + 1)
    else if (BOOL.has(name)) flags[name] = "true"
    else flags[name] = argv[++i] ?? ""
  }
  return { flags, pos, rest }
}

// ---- http -------------------------------------------------------------------
type Ctx = { server: string; token?: string }
function ctx(flags: Record<string, string>): Ctx {
  const cfg = readJson<Config>(configFile())
  const proj = readJson<Project>(projectFile)
  const server = (flags.server || process.env.NIMBUS_SERVER || proj.server || cfg.server || "").replace(/\/+$/, "")
  if (!server) throw new Fail("No server. Run `nimbus login --server URL` or set NIMBUS_SERVER.", 2)
  return { server, token: process.env.NIMBUS_TOKEN || cfg.token }
}

async function call(c: Ctx, method: string, path: string, opts: { body?: unknown; headers?: Record<string, string>; auth?: boolean } = {}) {
  const headers: Record<string, string> = { accept: "application/json", ...opts.headers }
  if (opts.body !== undefined) headers["content-type"] = "application/json"
  if (opts.auth !== false) {
    if (!c.token) throw new Fail("Not signed in. Run `nimbus login` or set NIMBUS_TOKEN.", 4)
    headers.authorization = `Bearer ${c.token}`
  }
  let res: Response
  try {
    res = await fetch(`${c.server}/api/v1/secrets${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  } catch (e) {
    throw new Fail(`Cannot reach ${c.server}: ${(e as Error).message}`)
  }
  if (res.ok || res.status === 304) return res
  const j = (await res.json().catch(() => ({}))) as { error?: { message?: string }; unlockUrl?: string }
  const msg = j.error?.message || res.statusText
  if (res.status === 423)
    throw new Fail(`Secrets are locked. Unlock them in the web app${j.unlockUrl ? `: ${j.unlockUrl}` : ""}`, 3)
  if (res.status === 401) throw new Fail(`Unauthorized: ${msg}. Run \`nimbus login\`.`, 4)
  throw new Fail(`${res.status}: ${msg}`)
}

// ---- secrets ----------------------------------------------------------------
function target(flags: Record<string, string>) {
  const p = readJson<Project>(projectFile)
  const project = flags.project || process.env.NIMBUS_PROJECT || p.project || ""
  const env = flags.env || process.env.NIMBUS_ENV || p.env || ""
  const path = flags.path || p.path || "/"
  return { project, env, path }
}
function query(t: { project: string; env: string; path: string }) {
  const q = new URLSearchParams({ path: t.path, expand: "true" })
  if (t.project) q.set("project", t.project)
  if (t.env) q.set("env", t.env)
  return `/secrets?${q}`
}
async function fetchSecrets(c: Ctx, flags: Record<string, string>, etag?: string) {
  const res = await call(c, "GET", query(target(flags)), { headers: etag ? { "if-none-match": etag } : {} })
  if (res.status === 304) return null
  return { secrets: (await res.json()) as Secret[], etag: res.headers.get("etag") ?? "" }
}

// Always quoted so values with spaces, #, quotes or newlines survive any dotenv parser.
const q = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`
function format(secrets: Secret[], fmt: string): string {
  const sorted = [...secrets].sort((a, b) => a.key.localeCompare(b.key))
  if (fmt === "json") return JSON.stringify(Object.fromEntries(sorted.map((s) => [s.key, s.value])), null, 2) + "\n"
  if (fmt === "yaml") return sorted.map((s) => `${s.key}: ${JSON.stringify(s.value)}\n`).join("")
  if (fmt === "dotenv") return sorted.map((s) => `${s.key}=${q(s.value)}\n`).join("")
  throw new Fail(`Unknown format "${fmt}" (dotenv, json, yaml)`, 2)
}

function writeAtomic(file: string, data: string) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, data, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
}

// ---- commands ---------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function login(flags: Record<string, string>) {
  const c = ctx(flags)
  const dev = `${hostname()} (${platform()})`
  const s = (await (await call(c, "POST", "/auth/device/start", { auth: false, body: { deviceName: dev } })).json()) as {
    userCode: string; verifyUrl: string; pollToken: string; expiresIn: number; interval?: number
  }
  console.log(`Open ${s.verifyUrl}\nand confirm the code ${s.userCode}`)
  const deadline = Date.now() + s.expiresIn * 1000
  while (Date.now() < deadline) {
    await sleep((s.interval ?? 2) * 1000)
    const res = await fetch(`${c.server}/api/v1/secrets/auth/device/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pollToken: s.pollToken }),
    })
    if (res.status === 202) continue
    if (res.status === 403) throw new Fail("Sign-in was denied.")
    if (res.status !== 200) throw new Fail("Sign-in code expired. Try again.")
    const j = (await res.json()) as { token: string; user?: { email?: string } }
    saveConfig({ server: c.server, token: j.token })
    console.log(`Signed in${j.user?.email ? ` as ${j.user.email}` : ""}.`)
    return
  }
  throw new Fail("Sign-in code expired. Try again.")
}

async function logout() {
  const cfg = readJson<Config>(configFile())
  if (cfg.token && cfg.server) {
    // Best effort: still forget the token locally if the server is down.
    await call({ server: cfg.server, token: cfg.token }, "POST", "/auth/logout").catch(() => {})
  }
  saveConfig({ server: cfg.server })
  console.log("Signed out.")
}

async function whoami(flags: Record<string, string>) {
  const w = (await (await call(ctx(flags), "GET", "/whoami")).json()) as { type: string; name: string; email?: string }
  console.log(`${w.type === "machine" ? "token" : w.email || w.name} (${w.type}) on ${ctx(flags).server}`)
}

async function init(flags: Record<string, string>) {
  const t = target(flags)
  if (!t.project) throw new Fail("Pass --project (and --env).", 2)
  const out: Project = { project: t.project, env: t.env, path: t.path }
  writeFileSync(projectFile, JSON.stringify(out, null, 2) + "\n")
  console.log(`Wrote ${projectFile}`)
}

async function secrets(flags: Record<string, string>) {
  const r = await fetchSecrets(ctx(flags), flags)
  for (const s of r!.secrets) console.log(`${s.key}\t${flags.plain ? s.value.replace(/\n/g, "\\n") : "********"}`)
}

async function exportCmd(flags: Record<string, string>) {
  const r = await fetchSecrets(ctx(flags), flags)
  process.stdout.write(format(r!.secrets, flags.format || "dotenv"))
}

function run(flags: Record<string, string>, cmd: string[]) {
  if (!cmd.length) throw new Fail("Usage: nimbus run [--env E] -- <command>", 2)
  return fetchSecrets(ctx(flags), flags).then(
    (r) =>
      new Promise<number>((resolve) => {
        const env = { ...process.env }
        for (const s of r!.secrets) env[s.key] = s.value
        const child = spawn(cmd[0], cmd.slice(1), { env, stdio: "inherit" })
        const fwd = (sig: NodeJS.Signals) => child.kill(sig)
        const sigs: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"]
        sigs.forEach((s) => process.on(s, fwd))
        child.on("error", (e) => {
          console.error(`nimbus: ${e.message}`)
          resolve(127)
        })
        child.on("exit", (code, sig) => resolve(sig ? 128 + (({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15, SIGKILL: 9 } as Record<string, number>)[sig] ?? 1) : (code ?? 1)))
      })
  )
}

async function agent(flags: Record<string, string>) {
  const out = flags.out
  if (!out) throw new Fail("--out FILE is required.", 2)
  const fmt = flags.format || "dotenv"
  const interval = Math.max(1, Number(flags.interval || 30))
  const c = ctx(flags)
  let etag: string | undefined
  for (;;) {
    try {
      const r = await fetchSecrets(c, flags, etag)
      if (r) {
        etag = r.etag || undefined
        const data = format(r.secrets, fmt)
        const same = existsSync(out) && readFileSync(out, "utf8") === data
        if (!same) {
          mkdirSync(dirname(out), { recursive: true })
          writeAtomic(out, data)
          console.error(`nimbus: wrote ${out}`)
          if (flags["on-change"]) await new Promise<void>((res) => spawn("sh", ["-c", flags["on-change"]], { stdio: "inherit", env: { ...process.env, NIMBUS_OUT: out } }).on("exit", () => res()))
        }
      }
    } catch (e) {
      // Locked/network errors are retried; a bad token or usage error is fatal (and fatal on the first run).
      if (!(e instanceof Fail) || e.code === 4 || e.code === 2 || !etag && flags.once) throw e
      console.error(`nimbus: ${e.message}`)
    }
    if (flags.once) return
    await sleep(interval * 1000)
  }
}

// Prints the ssh command to use. With --key the certificate is written next to that key
// (KEY-cert.pub); otherwise Nimbus makes a key pair and both land under --out
// (default ~/.ssh/nimbus_cert, the certificate as nimbus_cert-cert.pub).
async function sshCert(flags: Record<string, string>) {
  const principals = (flags.principal || "").split(",").map((p) => p.trim()).filter(Boolean)
  if (!principals.length) throw new Fail("Pass --principal user[,user] (the accounts it may log in as).", 2)
  const ttl = Number(flags.ttl || 1)
  const body: Record<string, unknown> = { project: target(flags).project, principals, ttl }
  if (!body.project) throw new Fail("Pass --project.", 2)
  if (flags.key) body.publicKey = readFileSync(flags.key, "utf8").trim()
  const r = (await (await call(ctx(flags), "POST", "/ssh/cert", { body })).json()) as { certificate: string; privateKey: string | null; expiresAt: string }
  const keyFile = flags.key ? flags.key.replace(/\.pub$/, "") : flags.out || join(homedir(), ".ssh", "nimbus_cert")
  const certFile = `${keyFile}-cert.pub`
  mkdirSync(dirname(keyFile), { recursive: true })
  if (r.privateKey) writeAtomic(keyFile, r.privateKey)
  writeFileSync(certFile, r.certificate + "\n", { mode: 0o644 })
  console.log(`Certificate valid until ${r.expiresAt}: ${certFile}`)
  console.log(`ssh -i ${keyFile} -o CertificateFile=${certFile} ${principals[0]}@HOST`)
}

async function main() {
  const { flags, pos, rest } = parse(process.argv.slice(2))
  const cmd = pos[0]
  if (!cmd || flags.help) return console.log(HELP)
  switch (cmd) {
    case "login": return login(flags)
    case "logout": return logout()
    case "whoami": return whoami(flags)
    case "init": return init(flags)
    case "secrets": return secrets(flags)
    case "export": return exportCmd(flags)
    case "agent": return agent(flags)
    case "ssh":
      if (pos[1] !== "cert") throw new Fail(`Usage: nimbus ssh cert --project P --principal user\n${HELP}`, 2)
      return sshCert(flags)
    case "run": process.exitCode = await run(flags, rest); return
    default: throw new Fail(`Unknown command "${cmd}"\n${HELP}`, 2)
  }
}

main().catch((e) => {
  if (e instanceof Fail) {
    console.error(`nimbus: ${e.message}`)
    process.exit(e.code)
  }
  throw e
})
