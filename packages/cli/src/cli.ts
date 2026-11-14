#!/usr/bin/env node
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
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
  dynamic get NAME [--project P] [--ttl 1h] [--format env|json|url] [--prefix DB_]
                         issue a short-lived database user on connection NAME (env lines by default)
  dynamic list | dynamic revoke LEASE_ID [--project P]
  kms encrypt|decrypt|sign|verify --key K [--project P] [--in FILE | --text S | stdin] [--context S]
                         [--signature SIG (verify)] [--out FILE]; kms keys lists the project's keys
  share ["TEXT" | stdin] [--expires 1d] [--views 1] [--password[=PW]] [--label L]
                         one-time link (1h-30d, 1-100 views); bare --password makes one up
  share list | share revoke ID
  webhooks [list] | webhooks add URL | webhooks remove ID | webhooks test ID   (--env E)
  push list | push run --env E | push remove --env E
  push set --env E --host H --user U --path FILE [--port 22] [--key FILE | --key-id ID]
                         [--command CMD] [--auto]   write the env's .env to a server over SSH
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
  writeAtomic(configFile(), JSON.stringify(c, null, 2))
}
const projectFile = ".nimbus.json"

// ---- args -------------------------------------------------------------------
const BOOL = new Set(["plain", "once", "help", "password", "auto"])
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
  // The saved sign-in only goes to the server it came from, never to one a cloned
  // repo's .nimbus.json (or a stray --server) points at.
  const saved = cfg.server?.replace(/\/+$/, "") === server ? cfg.token : undefined
  return { server, token: process.env.NIMBUS_TOKEN || saved }
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
  if (res.status === 401) throw new Fail(`Unauthorized: ${msg.replace(/\.$/, "")}. Run \`nimbus login\`.`, 4)
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

// Always quoted so values with spaces, #, quotes or newlines survive any dotenv parser;
// $ and ` are escaped too, so sourcing the file (or eval) never runs a value.
const q = (v: string) => `"${v.replace(/[\\"$`]/g, "\\$&").replace(/\n/g, "\\n")}"`
function format(secrets: Secret[], fmt: string): string {
  // Code-point order, the same as the Go binary and the bash script.
  const sorted = [...secrets].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  if (fmt === "json") return JSON.stringify(Object.fromEntries(sorted.map((s) => [s.key, s.value])), null, 2) + "\n"
  if (fmt === "yaml") return sorted.map((s) => `${s.key}: ${JSON.stringify(s.value)}\n`).join("")
  if (fmt === "dotenv") return sorted.map((s) => `${s.key}=${q(s.value)}\n`).join("")
  throw new Fail(`Unknown format "${fmt}" (dotenv, json, yaml)`, 2)
}

// A fresh 0600 file (wx: never through a planted symlink or someone else's file), then renamed over.
function writeAtomic(file: string, data: string) {
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`
  writeFileSync(tmp, data, { mode: 0o600, flag: "wx" })
  try {
    renameSync(tmp, file)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
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

// KMS (CONTRACT.md "KMS"). Data goes in as base64; encrypt and sign print the ciphertext or
// signature, decrypt writes the bytes (stdout or --out), verify exits 1 when it doesn't match.
async function kms(flags: Record<string, string>, pos: string[]) {
  const c = ctx(flags)
  const project = target(flags).project
  const op = pos[1]
  if (op === "keys") {
    const r = (await (await call(c, "GET", `/kms/keys${project ? `?project=${encodeURIComponent(project)}` : ""}`)).json()) as { keys: { name: string; kind: string; state: string; latest: number }[] }
    for (const k of r.keys) console.log(`${k.name}\t${k.kind}\tv${k.latest}\t${k.state}`)
    return
  }
  if (!["encrypt", "decrypt", "sign", "verify"].includes(op) || !flags.key) throw new Fail(`Usage: nimbus kms encrypt|decrypt|sign|verify --key K\n${HELP}`, 2)
  const input = flags.text !== undefined ? Buffer.from(flags.text) : flags.in ? readFileSync(flags.in) : readFileSync(0)
  const body: Record<string, unknown> = { key: flags.key }
  if (project) body.project = project
  if (flags.context) body.context = flags.context
  if (op === "decrypt") body.ciphertext = input.toString("utf8").trim()
  else body.data = input.toString("base64")
  if (op === "verify") body.signature = (flags.signature || "").trim()
  const r = (await (await call(c, "POST", `/kms/${op}`, { body })).json()) as { ciphertext?: string; signature?: string; data?: string; valid?: boolean }
  if (op === "encrypt") console.log(r.ciphertext)
  else if (op === "sign") console.log(r.signature)
  else if (op === "decrypt") {
    const out = Buffer.from(r.data ?? "", "base64")
    if (flags.out) writeFileSync(flags.out, out, { mode: 0o600 })
    else process.stdout.write(out)
  } else {
    console.log(r.valid ? "valid" : "invalid")
    if (!r.valid) process.exitCode = 1
  }
}

// Short-lived database users (CONTRACT.md "Dynamic database credentials"). `get` prints
// shell-safe env lines (NAME=value, quoted) so `eval "$(nimbus dynamic get db)"` works.
async function dynamic(flags: Record<string, string>, pos: string[]) {
  const c = ctx(flags)
  const project = target(flags).project
  const sub = pos[1]
  if (sub === "list") {
    const r = (await (await call(c, "GET", `/dynamic${project ? `?project=${encodeURIComponent(project)}` : ""}`)).json()) as { connections: { name: string; engine: string; defaultTtl: number; maxTtl: number }[] }
    for (const x of r.connections) console.log(`${x.name}\t${x.engine}\tdefault ${x.defaultTtl}s\tmax ${x.maxTtl}s`)
    return
  }
  if (sub === "revoke") {
    if (!pos[2]) throw new Fail("Usage: nimbus dynamic revoke LEASE_ID", 2)
    await call(c, "DELETE", `/dynamic?lease=${encodeURIComponent(pos[2])}${project ? `&project=${encodeURIComponent(project)}` : ""}`)
    console.error("Revoked.")
    return
  }
  if (sub !== "get" || !pos[2]) throw new Fail(`Usage: nimbus dynamic get NAME [--ttl 1h] [--format env|json|url]\n${HELP}`, 2)
  const body: Record<string, unknown> = { connection: pos[2] }
  if (project) body.project = project
  if (flags.ttl) body.ttl = flags.ttl
  const r = (await (await call(c, "POST", "/dynamic", { body })).json()) as { leaseId: string; username: string; password: string; host: string; port: number; database: string; url: string; expiresAt: string; engine: string }
  const fmt = flags.format || "env"
  if (fmt === "json") return void process.stdout.write(JSON.stringify({ leaseId: r.leaseId, engine: r.engine, host: r.host, port: r.port, database: r.database, username: r.username, password: r.password, url: r.url, expiresAt: r.expiresAt }, null, 2) + "\n")
  if (fmt === "url") return void console.log(r.url)
  if (fmt !== "env") throw new Fail(`Unknown format "${fmt}" (env, json, url)`, 2)
  const p = flags.prefix ?? "DB_"
  const vars: [string, string][] = [["HOST", r.host], ["PORT", String(r.port)], ["NAME", r.database], ["USER", r.username], ["PASSWORD", r.password], ["URL", r.url], ["LEASE_ID", r.leaseId], ["EXPIRES_AT", r.expiresAt]]
  process.stdout.write(vars.filter(([, v]) => v !== "").map(([k, v]) => `${p}${k}=${q(v)}\n`).join(""))
  console.error(`nimbus: lease ${r.leaseId} ends ${r.expiresAt}`)
}

const enc = encodeURIComponent

// One-time share links (CONTRACT.md "Share links"). A member's sign-in only: links belong to a person.
async function share(flags: Record<string, string>, pos: string[]) {
  const c = ctx(flags)
  if (pos[1] === "list") {
    const r = (await (await call(c, "GET", "/shares")).json()) as { shares: { id: string; state: string; views: number; maxViews: number; expiresAt: string; label: string | null }[] }
    for (const s of r.shares) console.log(`${s.id}\t${s.state}\t${s.views}/${s.maxViews}\t${s.expiresAt}\t${s.label ?? ""}`)
    return
  }
  if (pos[1] === "revoke") {
    if (!pos[2]) throw new Fail("Usage: nimbus share revoke ID", 2)
    await call(c, "DELETE", `/shares?id=${enc(pos[2])}`)
    return void console.error("Revoked.")
  }
  // A stray word means `--password secret "text"`: refuse rather than share the password.
  if (pos.length > 2) throw new Fail("Quote the text (or pipe it in), and use --password=VALUE for your own password.", 2)
  const text = pos[1] ?? readFileSync(0, "utf8")
  const m = (flags.expires || "1d").match(/^(\d+)([mhd]?)$/)
  if (!m) throw new Fail("--expires is like 90m, 12h or 7d.", 2)
  const minutes = Number(m[1]) * ({ m: 1, h: 60, d: 1440 } as Record<string, number>)[m[2] || "h"]
  const password = flags.password === "true" ? randomBytes(12).toString("base64url") : flags.password
  const body = { text, minutes, maxViews: Number(flags.views || 1), password, label: flags.label }
  const r = (await (await call(c, "POST", "/shares", { body })).json()) as { url: string }
  console.log(r.url)
  if (flags.password === "true") console.error(`Password: ${password}  (send it another way)`)
}

function envTarget(flags: Record<string, string>, needEnv = true) {
  const t = target(flags)
  if (!t.project || (needEnv && !t.env)) throw new Fail(`Pass --project${needEnv ? " and --env" : ""} (or run nimbus init).`, 2)
  return { ...t, base: `/projects/${enc(t.project)}/envs/${enc(t.env)}` }
}

// Per-environment webhooks (CONTRACT.md "Webhooks and server push"). Project admins only.
async function webhooks(flags: Record<string, string>, pos: string[]) {
  const c = ctx(flags)
  const base = `${envTarget(flags).base}/webhooks`
  const [, sub = "list", arg] = pos
  if (sub === "list") {
    const r = (await (await call(c, "GET", base)).json()) as { hooks: { id: string; url: string; enabled: boolean }[] }
    for (const h of r.hooks) console.log(`${h.id}\t${h.enabled ? "on" : "off"}\t${h.url}`)
    return
  }
  if (!arg || !["add", "remove", "test"].includes(sub)) throw new Fail(`Usage: nimbus webhooks list|add URL|remove ID|test ID --env E\n${HELP}`, 2)
  if (sub === "add") {
    const r = (await (await call(c, "POST", base, { body: { url: arg } })).json()) as { id: string; secret: string }
    return void console.log(`${r.id}\nSigning secret (shown once): ${r.secret}`)
  }
  if (sub === "remove") {
    await call(c, "DELETE", `${base}/${enc(arg)}`)
    return void console.error("Removed.")
  }
  const r = (await (await call(c, "POST", `${base}/${enc(arg)}/test`)).json()) as { status: string; httpStatus: number | null; message: string | null }
  console.log(r.status === "delivered" ? `delivered (${r.httpStatus})` : `failed: ${r.message ?? r.httpStatus}`)
  if (r.status !== "delivered") process.exitCode = 1
}

// Server push over SSH. Admins set it up; `run` also takes a read-write machine token (a deploy step).
async function push(flags: Record<string, string>, pos: string[]) {
  const c = ctx(flags)
  const sub = pos[1] ?? "list"
  if (sub === "list") {
    const t = envTarget(flags, false)
    const r = (await (await call(c, "GET", `/projects/${enc(t.project)}/push`)).json()) as { targets: { env: string; host: string; port: number; username: string; path: string; auto: boolean; lastOk: boolean | null; lastMessage: string | null }[] }
    for (const x of r.targets)
      console.log(`${x.env}\t${x.username}@${x.host}:${x.port}\t${x.path}\t${x.auto ? "auto" : "manual"}\t${x.lastOk === null ? "never" : x.lastOk ? "ok" : "failed"}\t${x.lastMessage ?? ""}`)
    return
  }
  const base = `${envTarget(flags).base}/push`
  if (sub === "run") return void console.log(((await (await call(c, "POST", base)).json()) as { message: string }).message)
  if (sub === "remove") return void (await call(c, "DELETE", base), console.error("Removed."))
  if (sub !== "set") throw new Fail(`Usage: nimbus push list|set|run|remove --env E\n${HELP}`, 2)
  if (!flags.host || !flags.user || !flags.path) throw new Fail("push set needs --host, --user and --path.", 2)
  const body = {
    host: flags.host,
    port: Number(flags.port || 22),
    username: flags.user,
    path: flags.path,
    ...(flags.key && { privateKey: readFileSync(flags.key, "utf8") }),
    ...(flags["key-id"] && { keyId: flags["key-id"] }),
    postCommand: flags.command || "",
    auto: flags.auto === "true",
  }
  await call(c, "PUT", base, { body })
  console.error("Saved. Run `nimbus push run` to push now.")
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
    case "dynamic": return dynamic(flags, pos)
    case "kms": return kms(flags, pos)
    case "share": return share(flags, pos)
    case "webhooks": return webhooks(flags, pos)
    case "push": return push(flags, pos)
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
