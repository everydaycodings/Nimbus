// Runs rclone for Cloud Import. A remote's options come from the member's saved connection (sealed in the database); they go into a
// temporary config file (mode 0600, in a private temp folder, named by RCLONE_CONFIG) that is deleted when the work is done and never
// kept anywhere else. rclone refreshes OAuth tokens as it works, so the token is read back and handed to `onToken` to be saved.
import "server-only"

import { spawn } from "node:child_process"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough, type Readable } from "node:stream"

import { ini, iniFields, parseLs, type LsEntry } from "./rules.ts"

export type Remote = {
  // rclone's backend name: "drive", "s3", …
  type: string
  // Prefix inside the remote: an S3 bucket, else "".
  root: string
  fields: Record<string, string>
}
export type ListFlags = { metadata?: boolean; sharedWithMe?: boolean }

// spawn wants ProcessEnv, which Next narrows (NODE_ENV); ours is a plain few variables.
type Env = NodeJS.ProcessEnv
const env = (e: Record<string, string>) => e as unknown as Env
const NAME = "src"
const MAX_LIST = 512 * 1024 * 1024

// What the member can act on, from rclone's last words.
export function friendly(stderr: string): string {
  const text = stderr.trim()
  const last = text.split("\n").filter((l) => /error|failed|denied|invalid|couldn't|can't|unauthor|refused|timeout/i.test(l)).pop() ?? text.split("\n").pop() ?? ""
  const msg = last.replace(/^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d\s+\w+\s*:\s*/, "").replace(/^Failed to [\w ]+ ?: ?/, "").trim()
  if (/invalid_grant|token expired|unauthorized_client|401|AADSTS|expired_access_token/i.test(text)) return "The service refused the saved sign-in. Reconnect this connection."
  if (/ENOENT|executable file not found|not found in \$PATH/i.test(text)) return "rclone isn't installed on this server."
  if (/permission denied|AccessDenied|403/i.test(text) && !/publickey/i.test(text)) return "Access was denied. Check the keys or login, and that they can read this place."
  if (/ssh: handshake failed|unable to authenticate/i.test(text)) return "The SFTP server refused that login."
  if (/no such host|connection refused|i\/o timeout|dial tcp/i.test(text)) return `Couldn't reach the server. ${msg}`.slice(0, 240)
  return (msg || "rclone stopped without saying why.").slice(0, 300)
}

type Out = { code: number | null; stdout: Buffer; stderr: string }

function run(env: Env, args: string[], o: { timeout?: number; input?: string; signal?: AbortSignal } = {}): Promise<Out> {
  return new Promise((resolve, reject) => {
    const p = spawn("rclone", args, { env, stdio: ["pipe", "pipe", "pipe"], signal: o.signal })
    const out: Buffer[] = []
    let len = 0
    let err = ""
    const timer = o.timeout ? setTimeout(() => p.kill("SIGKILL"), o.timeout) : undefined
    p.stdout.on("data", (c: Buffer) => {
      len += c.length
      if (len > MAX_LIST) return void p.kill("SIGKILL")
      out.push(c)
    })
    p.stderr.on("data", (c) => (err = (err + c).slice(-4000)))
    p.on("error", (e) => (clearTimeout(timer), reject(e)))
    p.on("close", (code, sig) => {
      clearTimeout(timer)
      if (len > MAX_LIST) return reject(new Error("That is too many files to list at once. Pick smaller folders."))
      if (sig === "SIGKILL" && o.timeout) return reject(new Error("The service took too long to answer."))
      resolve({ code, stdout: Buffer.concat(out), stderr: err })
    })
    p.stdin.on("error", () => {})
    p.stdin.end(o.input)
  })
}

// rclone wants passwords in its own reversible "obscured" form in a config file.
export async function obscure(plain: string): Promise<string> {
  const r = await run(env({ PATH: process.env.PATH ?? "" }), ["obscure", "-"], { input: plain, timeout: 10_000 })
  if (r.code !== 0) throw new Error(friendly(r.stderr))
  return r.stdout.toString().trim()
}

export type Session = ReturnType<typeof session>

function session(env: Env, remote: Remote) {
  const at = (path = "") => `${NAME}:${[remote.root, path].filter(Boolean).join("/")}`
  const flags = (f: ListFlags = {}) => [
    ...(remote.type === "drive" ? ["--drive-export-formats", "docx,xlsx,pptx"] : []),
    ...(remote.type === "drive" && f.sharedWithMe ? ["--drive-shared-with-me"] : []),
  ]
  const ok = async (args: string[], o: Parameters<typeof run>[2]) => {
    const r = await run(env, args, o)
    if (r.code !== 0) throw new Error(friendly(r.stderr))
    return r.stdout.toString()
  }
  return {
    // Proves the login works: lists the top level.
    check: (signal?: AbortSignal) => ok(["lsd", at(), ...flags()], { timeout: 45_000, signal }).then(() => undefined),
    dirs: async (path: string, f?: ListFlags) =>
      parseLs(await ok(["lsjson", "--dirs-only", "--no-mimetype", ...flags(f), at(path)], { timeout: 90_000 }))
        .filter((e) => e.IsDir)
        .sort((a, b) => a.Name.localeCompare(b.Name)),
    // Files and bytes under a folder (Google Docs have no size until exported, so they count as files of 0 bytes).
    size: async (path: string, f?: ListFlags) => {
      const j = JSON.parse(await ok(["size", "--json", ...flags(f), at(path)], { timeout: 10 * 60_000 })) as { count: number; bytes: number }
      return { count: j.count, bytes: Math.max(0, j.bytes) }
    },
    // Every file below a folder, with hashes (and Drive's stars and descriptions when asked).
    // ponytail: read whole into memory (capped at 512 MB of JSON, about a million files); stream-parse if that is ever too little.
    list: async (path: string, f: ListFlags = {}): Promise<LsEntry[]> =>
      parseLs(await ok(["lsjson", "-R", "--files-only", "--hash", "--no-mimetype", ...(f.metadata ? ["--metadata"] : []), ...flags(f), at(path)], { timeout: 60 * 60_000 })).filter((e) => !e.IsDir),
    // The file's bytes. A failing rclone errors the stream, so a cut-off download is never taken for a whole file.
    cat: (path: string, f?: ListFlags): { stream: Readable; kill: () => void } => {
      const p = spawn("rclone", ["cat", ...flags(f), at(path)], { env, stdio: ["ignore", "pipe", "pipe"] })
      const out = new PassThrough()
      let err = ""
      p.stderr.on("data", (c) => (err = (err + c).slice(-4000)))
      p.stdout.pipe(out, { end: false })
      p.on("error", (e) => out.destroy(e))
      p.on("close", (code) => {
        if (code === 0) out.end()
        else out.destroy(new Error(friendly(err)))
      })
      out.on("close", () => p.kill("SIGKILL"))
      return { stream: out, kill: () => p.kill("SIGKILL") }
    },
  }
}

// Runs `fn` with a session on the remote; the config file exists only inside this call.
export async function withRemote<T>(remote: Remote, fn: (s: Session) => Promise<T>, onToken?: (fields: Record<string, string>) => Promise<void>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "nimbus-rclone-"))
  const file = join(dir, "rclone.conf")
  try {
    await writeFile(file, ini(NAME, { type: remote.type, ...remote.fields }), { mode: 0o600 })
    await chmod(file, 0o600)
    const vars = env({ PATH: process.env.PATH ?? "", HOME: dir, RCLONE_CONFIG: file })
    try {
      return await fn(session(vars, remote))
    } finally {
      if (onToken && remote.fields.token) {
        const now = iniFields(await readFile(file, "utf8").catch(() => "")).token
        if (now && now !== remote.fields.token) await onToken({ ...remote.fields, token: now }).catch(() => {})
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
