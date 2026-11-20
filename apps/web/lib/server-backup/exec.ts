// Running ssh and restic: a transport to a host (ssh with the stored key and pinned host key, or a local shell for this
// Nimbus server), restic's environment, and small spawn helpers. The key and the pinned known_hosts live in a 0700 temp
// folder for as long as a run needs them.
import "server-only"

import { spawn, type ChildProcess } from "node:child_process"
import { lookup } from "node:dns/promises"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { isIP } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { decrypt } from "@/lib/crypto"
import type { serverBackupHosts, serverBackupJobs } from "@/lib/db/schema"
import { knownHostsLine, repoOpts, repoUrl, tail, type RepoDest } from "./rules"

export type Host = typeof serverBackupHosts.$inferSelect
export type Job = typeof serverBackupJobs.$inferSelect

export const CACHE = join(tmpdir(), "nimbus-server-backup", "cache")
const clean = (env: Record<string, string | undefined>) => Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as NodeJS.ProcessEnv

export type Cmd = { file: string; args: string[] }
export type Transport = (cmd: string) => Cmd

// Calls `withIt` with a way to run a shell command on the host, then removes the key from disk.
export async function withTransport<T>(host: Host, withIt: (t: Transport) => Promise<T>): Promise<T> {
  if (host.isSelf) return withIt((cmd) => ({ file: "sh", args: ["-c", cmd] }))
  if (!host.privateKeyEnc || !host.host) throw new Error("This server has no SSH key. Add it again.")
  const key = decrypt(host.privateKeyEnc)
  if (!key) throw new Error("The saved SSH key can't be read. Add the server again.")
  if (!host.hostKey) throw new Error("This server's host key isn't recorded yet. Open Servers and test the connection first.")
  const dir = await mkdtemp(join(tmpdir(), "nimbus-sb-"))
  try {
    await writeFile(join(dir, "id"), key, { mode: 0o600 })
    await writeFile(join(dir, "known_hosts"), knownHostsLine(host.host, host.port, host.hostKey), { mode: 0o600 })
    const common = [
      "-F", "/dev/null", "-i", join(dir, "id"), "-p", String(host.port), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${join(dir, "known_hosts")}`, "-o", `HostKeyAlgorithms=${host.hostKey.split(" ")[0]}`,
      "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30", "-o", "LogLevel=ERROR",
    ]
    return await withIt((cmd) => ({ file: "ssh", args: [...common, `${host.username}@${host.host}`, cmd] }))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export type Result = { code: number | null; out: string; err: string }

// Runs a command to the end. cap: bytes of stdout kept.
export function exec(c: Cmd, o: { env?: Record<string, string | undefined>; input?: string; timeout?: number; cap?: number } = {}): Promise<Result> {
  return new Promise((resolve) => {
    const p = spawn(c.file, c.args, { env: clean(o.env ?? { PATH: process.env.PATH, HOME: tmpdir(), LC_ALL: "C" }), stdio: ["pipe", "pipe", "pipe"], timeout: o.timeout ?? 60_000 })
    let out = ""
    let err = ""
    p.stdout.on("data", (b: Buffer) => out.length < (o.cap ?? 4_000_000) && (out += b))
    p.stderr.on("data", (b: Buffer) => (err = tail(err + b, 8000)))
    p.on("error", (e) => resolve({ code: null, out, err: `${err}${e.message}` }))
    p.on("close", (code) => resolve({ code, out, err }))
    p.stdin.on("error", () => {})
    p.stdin.end(o.input)
  })
}

// ssh's own failures in words.
export function sshProblem(err: string, host: Host): string {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|host key for .* has changed|no matching host key type/i.test(err))
    return `The host key of ${host.host} is not the one Nimbus recorded. Someone may be impersonating the server, or it was reinstalled. Runs are blocked until you review it in Servers and trust the new key.`
  if (/Permission denied/i.test(err)) return `${host.host} refused the key. Add the public key to ${host.username}'s ~/.ssh/authorized_keys.`
  if (/Connection refused/i.test(err)) return `${host.host}:${host.port} refused the connection. Is SSH running there?`
  if (/timed out|No route|Could not resolve|Name or service not known/i.test(err)) return `Couldn't reach ${host.host}:${host.port}.`
  return err.trim().split("\n").slice(-3).join(" ") || "The SSH connection failed."
}

// A member may point Nimbus at a LAN server, but not at this machine or a cloud metadata address.
export async function allowedTarget(name: string, admin: boolean): Promise<string | null> {
  if (admin) return null
  const addrs = isIP(name) ? [{ address: name }] : await lookup(name, { all: true }).catch(() => [])
  if (!addrs.length) return `Couldn't find ${name}.`
  for (const { address: a } of addrs) if (/^127\.|^::1$|^169\.254\.|^0\.|^fe80:/i.test(a)) return "Members can't back up this machine or link-local addresses. Ask an admin."
  return null
}

export const dockerSocket = () => stat(process.env.DOCKER_SOCKET ?? "/var/run/docker.sock").then((s) => s.isSocket(), () => false)

// ---- restic ---------------------------------------------------------------------------------------------------------

export function resticEnv(job: Job, secret: string, password: string) {
  return {
    PATH: process.env.PATH,
    HOME: tmpdir(),
    LC_ALL: "C",
    RESTIC_CACHE_DIR: CACHE,
    RESTIC_REPOSITORY: repoUrl(dest(job)),
    RESTIC_PASSWORD: password,
    AWS_ACCESS_KEY_ID: job.s3AccessKey ?? "",
    AWS_SECRET_ACCESS_KEY: secret,
    AWS_DEFAULT_REGION: job.s3Region || "us-east-1",
  }
}

export const dest = (job: Job): RepoDest => ({ s3Endpoint: job.s3Endpoint ?? "", s3Region: job.s3Region ?? "us-east-1", s3Bucket: job.s3Bucket ?? "", s3PathStyle: job.s3PathStyle, prefix: job.prefix })

// The job's repository: arguments and environment for every restic call.
export function repoOf(job: Job) {
  const password = decrypt(job.resticPasswordEnc)
  const secret = job.s3SecretEnc ? decrypt(job.s3SecretEnc) : ""
  if (!password || secret === null) throw new Error("The saved repository keys can't be read.")
  return { env: resticEnv(job, secret, password), opts: repoOpts(dest(job)) }
}

export const restic = (job: Job, args: string[]): Cmd & { env: Record<string, string | undefined> } => {
  const r = repoOf(job)
  return { file: "restic", args: [...r.opts, ...args], env: r.env }
}

export const run = (job: Job, args: string[], o: { timeout?: number; cap?: number } = {}) => {
  const c = restic(job, args)
  return exec(c, { env: c.env, timeout: o.timeout ?? 600_000, cap: o.cap })
}

export const spawnRestic = (job: Job, args: string[]): ChildProcess => {
  const c = restic(job, args)
  return spawn(c.file, c.args, { env: clean(c.env), stdio: ["ignore", "pipe", "pipe"] })
}

export const missingBinary = (r: Result, what: string) => (r.code === null && /ENOENT/.test(r.err) ? `${what} isn't installed in this image. Rebuild the Nimbus image.` : null)
