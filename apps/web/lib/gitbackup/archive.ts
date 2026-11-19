// The git and tar side of Git Backup. The token goes to git through environment variables
// (GIT_CONFIG_*: a header scoped to the host), never in a URL or in argv, and is scrubbed from errors.
// Relative imports only: runs under plain node in the self-check.
import { spawn } from "node:child_process"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Transform, type Readable } from "node:stream"

import { chain } from "../backup/dest.ts"
import { parseRefs } from "./refs.ts"

export const WORK = join(tmpdir(), "nimbus-gitbackup")
// protocols: what git may speak for this call (GIT_ALLOW_PROTOCOL); tests add "file".
// noRedirects: a user-typed remote may not send git elsewhere (it was checked as dialable, its redirect wasn't).
export type Auth = { token?: string; protocols?: string; noRedirects?: boolean }

const scrub = (s: string, token?: string) => {
  let out = s.replace(/\/\/[^/@\s]+@/g, "//***@")
  if (token) for (const t of [token, Buffer.from(`x-access-token:${token}`).toString("base64")]) out = out.split(t).join("***")
  return out
}

function gitEnv(url: string | null, a: Auth) {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: WORK,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ALLOW_PROTOCOL: a.protocols ?? "https:http",
    LC_ALL: "C",
  }
  const cfg: [string, string][] = []
  if (a.token && url?.startsWith("http")) cfg.push([`http.${new URL(url).origin}/.extraHeader`, `Authorization: Basic ${Buffer.from(`x-access-token:${a.token}`).toString("base64")}`])
  if (a.noRedirects) cfg.push(["http.followRedirects", "false"])
  cfg.forEach(([k, v], i) => ((env[`GIT_CONFIG_KEY_${i}`] = k), (env[`GIT_CONFIG_VALUE_${i}`] = v)))
  if (cfg.length) env.GIT_CONFIG_COUNT = String(cfg.length)
  return env
}

// Runs a command to the end. cap: stop reading after that many bytes (a file view) and kill it.
function run(cmd: string, args: string[], o: { cwd?: string; env: Record<string, string>; token?: string; cap?: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: o.cwd ?? process.cwd(), env: o.env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] })
    const out: Buffer[] = []
    let n = 0
    let err = ""
    let capped = false
    p.stdout.on("data", (b: Buffer) => {
      if (capped) return
      out.push(b)
      n += b.length
      if (o.cap && n >= o.cap) {
        capped = true
        p.kill()
      }
    })
    p.stderr.on("data", (b: Buffer) => (err = (err + b).slice(-4000)))
    p.on("error", (e) => reject(new Error(scrub(`${cmd}: ${e.message}`, o.token))))
    p.on("close", (code) => {
      if (code === 0 || capped) return resolve(Buffer.concat(out))
      const msg = err.trim().split("\n").filter(Boolean).slice(-3).join(" ")
      reject(new Error(scrub(`${cmd} ${args[0]} failed: ${msg || `exit ${code}`}`, o.token).slice(0, 400)))
    })
  })
}
const git = (args: string[], url: string | null, a: Auth, cwd?: string) => run("git", args, { cwd, env: gitEnv(url, a), token: a.token })

// The branches and tags on the remote, as name -> sha.
export async function lsRemote(url: string, a: Auth = {}) {
  await mkdir(WORK, { recursive: true })
  return parseRefs((await git(["ls-remote", "--refs", "--", url, "refs/heads/*", "refs/tags/*"], url, a)).toString())
}

export async function mirror(url: string, dir: string, a: Auth = {}) {
  await mkdir(WORK, { recursive: true })
  await git(["clone", "--mirror", "--quiet", "--", url, dir], url, a)
}

// ponytail: looks at the root .gitattributes of HEAD only; LFS rules in subfolders are missed.
export async function usesLfs(dir: string) {
  const out = await git(["--git-dir", dir, "show", "HEAD:.gitattributes"], null, {}).catch(() => Buffer.alloc(0))
  return /filter=lfs/.test(out.toString())
}

export async function lfsFetch(dir: string, url: string, a: Auth) {
  await git(["--git-dir", dir, "lfs", "fetch", "--all", url], url, a)
}

// HEAD of the default branch (all zeros for an empty repo) and its name.
export async function headInfo(dir: string) {
  const env = gitEnv(null, {})
  const sha = (await run("git", ["--git-dir", dir, "rev-parse", "HEAD"], { env }).catch(() => Buffer.from("0".repeat(40)))).toString().trim()
  const ref = (await run("git", ["--git-dir", dir, "symbolic-ref", "-q", "--short", "HEAD"], { env }).catch(() => Buffer.alloc(0))).toString().trim()
  return { sha, defaultBranch: ref || null }
}

// The bare repo `name` (a folder inside `parent`) as a tar.gz stream; bytes() is the size so far.
// Resolves `done` when tar has exited cleanly: check it after the upload, a short stream isn't an error by itself.
export function pack(parent: string, name: string, onBytes: (n: number) => void) {
  const tar = spawn("tar", ["-czf", "-", "-C", parent, name], { stdio: ["ignore", "pipe", "pipe"] as const })
  let err = ""
  tar.stderr.on("data", (b: Buffer) => (err = (err + b).slice(-500)))
  const done = new Promise<void>((resolve, reject) => {
    tar.on("error", reject)
    tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar failed: ${err.trim() || `exit ${code}`}`))))
  })
  done.catch(() => {})
  let n = 0
  const count = new Transform({
    transform(c: Buffer, _, cb) {
      n += c.length
      onBytes(n)
      cb(null, c)
    },
  })
  return { body: chain(tar.stdout, count), done, size: () => n }
}

// Unpacks a tar.gz stream into dir.
export async function extract(src: Readable, dir: string) {
  await mkdir(dir, { recursive: true })
  return new Promise<void>((resolve, reject) => {
    const tar = spawn("tar", ["-xzf", "-", "-C", dir], { stdio: ["pipe", "ignore", "pipe"] })
    let err = ""
    tar.stderr.on("data", (b: Buffer) => (err = (err + b).slice(-500)))
    tar.on("error", reject)
    tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar failed: ${err.trim() || `exit ${code}`}`))))
    src.on("error", (e) => {
      tar.kill()
      reject(e)
    })
    tar.stdin.on("error", () => {})
    src.pipe(tar.stdin)
  })
}

// An unpacked snapshot is untrusted (an external bucket can be written by others): no symlinks anywhere,
// no hooks, and a config of our own, so git run on it can't be made to run commands or read outside it.
export async function sealBare(dir: string) {
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true }))
    if (!e.isFile() && !e.isDirectory()) throw new Error("This snapshot holds links or special files; it won't be opened.")
  const format = (await run("git", ["config", "--file", join(dir, "config"), "extensions.objectformat"], { env: gitEnv(null, {}) }).catch(() => Buffer.alloc(0))).toString().trim()
  await rm(join(dir, "hooks"), { recursive: true, force: true })
  const sha256 = format === "sha256"
  await writeFile(join(dir, "config"), `[core]\n\trepositoryformatversion = ${sha256 ? 1 : 0}\n\tbare = true\n${sha256 ? "[extensions]\n\tobjectformat = sha256\n" : ""}`)
}

// Branch and tag names in a bare repo.
export async function refNames(dir: string) {
  const out = await run("git", ["--git-dir", dir, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags"], { env: gitEnv(null, {}) })
  return out.toString().split("\n").filter(Boolean)
}

// `ref` must be one of refNames() (short or full).
export async function lsTree(dir: string, ref: string, path: string) {
  const spec = path ? `${ref}:${path}` : ref
  const out = (await run("git", ["--git-dir", dir, "ls-tree", "-l", "-z", spec], { env: gitEnv(null, {}) })).toString()
  return out
    .split("\0")
    .filter(Boolean)
    .map((l) => {
      const m = /^\d+ (blob|tree|commit) \S+\s+(-|\d+)\t([\s\S]*)$/.exec(l)
      return m && m[1] !== "commit" ? { path: path ? `${path}/${m[3]}` : m[3], type: m[1] as "blob" | "tree", size: m[2] === "-" ? null : Number(m[2]) } : null
    })
    .filter((e): e is { path: string; type: "blob" | "tree"; size: number | null } => !!e)
    .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === "tree" ? -1 : 1))
}

export async function catFile(dir: string, ref: string, path: string, cap: number) {
  const env = gitEnv(null, {})
  const spec = `${ref}:${path}`
  const type = (await run("git", ["--git-dir", dir, "cat-file", "-t", spec], { env })).toString().trim()
  if (type !== "blob") throw new Error("That isn't a file.")
  const size = Number((await run("git", ["--git-dir", dir, "cat-file", "-s", spec], { env })).toString())
  const body = await run("git", ["--git-dir", dir, "cat-file", "blob", spec], { env, cap })
  return { size, body: body.subarray(0, cap) }
}

// Every branch and tag to the remote (not pull refs: hosts refuse to take them).
export async function push(dir: string, url: string, a: Auth, lfs: boolean) {
  if (lfs) await git(["--git-dir", dir, "lfs", "push", "--all", url], url, a)
  await git(["--git-dir", dir, "push", "--quiet", url, "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"], url, a)
}
