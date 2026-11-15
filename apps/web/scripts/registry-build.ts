// The image build runner (compose profile "build", docker/build-runner). A BullMQ worker on the
// registry-builds queue that clones or unpacks a source, drives BuildKit with buildctl, scans, tags,
// signs and reports back. It holds no database code: everything that needs Nimbus goes through
// POST /api/registry/runner (lib/registry/build-ops.ts).
//
// Safety: a pre-flight wait while the server is busy, a live guard that stops a build past the RAM or disk
// line, a timeout, cancel, and hard CPU/RAM caps on the buildkitd container itself. Concurrency is read
// once at start (restart the runner to change it). Run: node --env-file=.env.local scripts/registry-build.ts
import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve, sep } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import readline from "node:readline"

import { Worker, type Job } from "bullmq"

import {
  buildCacheKey,
  buildCancelKey,
  buildChannel,
  buildHeartbeat,
  buildLogKey,
  buildctlArgs,
  latestTag,
  matchRule,
  maskLine,
  parseRef,
  waitingText,
} from "../lib/registry/build-rules.ts"
import { guardVerdict, hostMetrics } from "../lib/host-metrics.ts"
import { BUILDS_QUEUE, redis, workerConnection } from "../lib/redis.ts"
import { getStream } from "../lib/s3.ts"
import { signToken } from "../lib/upload-rules.ts"

const app = (process.env.REGISTRY_BUILD_APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "")
const buildkit = process.env.BUILDKIT_HOST ?? ""
if (!buildkit) throw new Error("BUILDKIT_HOST isn't set (tcp://buildkitd:1234).")
const WORK = process.env.BUILD_WORK_DIR ?? join(tmpdir(), "nimbus-build")
const RECHECK_MS = Number(process.env.BUILD_RECHECK_MS) || 30_000
const GIVE_UP_MS = Number(process.env.BUILD_WAIT_GIVE_UP_MS) || 30 * 60_000
const LOG_CAP = 5 * 1024 * 1024
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- talking to the app --------------------------------------------------------------------------

async function rpc<T = unknown>(op: string, body: object = {}, timeoutMs = 60_000): Promise<T> {
  const res = await fetch(`${app}/api/registry/runner`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${signToken("registry-build", {}, 60_000)}` },
    body: JSON.stringify({ op, ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`${op}: the app answered ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`)
  return (await res.json()) as T
}

type Settings = {
  concurrency: number
  timeoutMin: number
  preflight: { ramPct: number; minDiskGb: number; loadFactor: number }
  guard: { ramPct: number; minDiskGb: number }
  enabled: boolean
}

type Prepared =
  | { ok: false; error: string; skip?: boolean }
  | {
      ok: true
      buildId: string
      name: string
      image: string
      insecure: boolean
      ref: string | null
      refType: "branch" | "tag" | null
      commit: string | null
      rule: { dockerfile: string; context: string; buildArgs: { key: string; value: string }[]; platforms: string[]; failOnCritical: boolean }
      clone: { kind: "github" | "git"; url: string; username?: string; token?: string; sshKey?: string } | null
      tarKey: string | null
      token: string
      secrets: Record<string, string>
      timeoutMin: number
    }

// ---- running programs -------------------------------------------------------------------------------

// Children get a bare environment: the runner's own holds the app's secrets.
const baseEnv = (home: string): Record<string, string> => ({ PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: home, LANG: "C.UTF-8" })

type Run = { code: number | null; out: string }

// Runs a program, sending each output line to `onLine`; resolves with the exit code and the last 4 KB of output.
function run(cmd: string, args: string[], o: { env: Record<string, string>; cwd?: string; onLine?: (l: string) => void; signal?: AbortSignal }): Promise<Run> {
  return new Promise((resolveRun) => {
    const p = spawn(cmd, args, { env: o.env as NodeJS.ProcessEnv, cwd: o.cwd, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    const feed = (stream: NodeJS.ReadableStream) =>
      readline.createInterface({ input: stream }).on("line", (l) => {
        out = (out + l + "\n").slice(-4096)
        o.onLine?.(l)
      })
    feed(p.stdout)
    feed(p.stderr)
    const kill = () => {
      p.kill("SIGTERM")
      setTimeout(() => p.kill("SIGKILL"), 10_000).unref()
    }
    if (o.signal?.aborted) kill()
    o.signal?.addEventListener("abort", kill, { once: true })
    p.on("error", (e) => resolveRun({ code: null, out: `${cmd}: ${e.message}` }))
    p.on("close", (code) => resolveRun({ code, out }))
  })
}

// ---- the log ------------------------------------------------------------------------------------------

function logger(buildId: string, secrets: () => string[]) {
  let seq = 0
  let bytes = 0
  let capped = false
  const lines: string[] = []
  const log = (raw: string) => {
    for (const piece of raw.split("\n")) {
      // BuildKit's plain progress puts a timestamp-free "#12 ..." per line; blank ones are noise.
      if (!piece.trim()) continue
      const text = maskLine(piece.replace(/\r/g, "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, ""), secrets())
      if (bytes > LOG_CAP) {
        if (capped) continue
        capped = true
        lines.push("[the log is over 5 MB; the rest is left out]")
        continue
      }
      bytes += text.length + 1
      lines.push(text)
      const msg = JSON.stringify({ s: seq++, t: text })
      redis
        .multi()
        .rpush(buildLogKey(buildId), msg)
        .ltrim(buildLogKey(buildId), -5000, -1)
        .expire(buildLogKey(buildId), 86_400)
        .publish(`events:${buildChannel(buildId)}`, msg)
        .exec()
        .catch(() => {})
    }
  }
  return { log, text: () => lines.join("\n") }
}

// ---- sources ------------------------------------------------------------------------------------------------

type Clone = NonNullable<Extract<Prepared, { ok: true }>["clone"]>

// Environment for git: a token goes as an Authorization header, an SSH key as a 0600 file.
async function gitEnv(c: Clone, dir: string): Promise<Record<string, string>> {
  const env: Record<string, string> = { ...baseEnv(dir), GIT_TERMINAL_PROMPT: "0" }
  if (c.token)
    Object.assign(env, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`${c.username || "git"}:${c.token}`).toString("base64")}`,
    })
  if (c.sshKey) {
    const key = join(dir, "id_key")
    await writeFile(key, c.sshKey, { mode: 0o600 })
    // ponytail: accept-new trusts a host the first time; pin host keys if that matters.
    env.GIT_SSH_COMMAND = `ssh -i ${key} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${join(dir, "known_hosts")}`
  }
  return env
}

async function unpack(tarKey: string, dir: string, log: (l: string) => void) {
  const file = join(dir, "context.bin")
  await pipeline(Readable.fromWeb((await getStream(tarKey)) as never), createWriteStream(file))
  const head = (await readFile(file)).subarray(0, 4)
  const zip = head[0] === 0x50 && head[1] === 0x4b
  const out = join(dir, "src")
  await mkdir(out)
  const r = zip
    ? await run("unzip", ["-q", "-o", file, "-d", out], { env: baseEnv(dir) })
    : await run("tar", ["-xf", file, "-C", out, "--no-same-owner", "--no-same-permissions"], { env: baseEnv(dir) })
  if (r.code !== 0) throw new Error(`Couldn't unpack the uploaded folder: ${r.out.trim().split("\n").pop()}`)
  await rm(file)
  // A zip of a folder usually holds that one folder.
  const top = await readdir(out)
  if (top.length === 1 && (await stat(join(out, top[0]))).isDirectory()) {
    log(`Using the folder ${top[0]}/ from the upload.`)
    return join(out, top[0])
  }
  return out
}

// A path inside the source, after symlinks: BuildKit reads the Dockerfile and context from this machine.
async function inside(root: string, rel: string, what: string) {
  const p = resolve(root, rel)
  const real = await realpath(p).catch(() => null)
  const base = await realpath(root)
  if (!real) throw new Error(`${what} "${rel}" isn't in the source.`)
  if (real !== base && !real.startsWith(base + sep)) throw new Error(`${what} "${rel}" points outside the source.`)
  return real
}

// ---- one build -------------------------------------------------------------------------------------------------

type Outcome = { status: "success" | "failed" | "cancelled" | "stopped"; reason: string | null; digest: string | null }

async function runBuild(buildId: string) {
  const secretValues: string[] = []
  const { log, text } = logger(buildId, () => secretValues)
  let out: Outcome = { status: "failed", reason: "The build didn't run.", digest: null }
  const work = join(WORK, buildId)
  // The cancel flag holds the name of whoever cancelled.
  let by = ""
  const cancelled = async () => {
    const who = await redis.get(buildCancelKey(buildId)).catch(() => null)
    if (who !== null) by = who
    return who !== null
  }
  const cancelOutcome = (): Outcome => ({ status: "cancelled", reason: by ? `Cancelled by ${by}` : "Cancelled", digest: null })
  const stop = new AbortController()
  let finished = false
  let tagged = false
  try {
    let s = await rpc<Settings>("settings")
    // -- pre-flight: wait while the server is busy (the limits are read again each round, so raising one lets it go)
    const began = Date.now()
    let last = ""
    for (;;) {
      if (await cancelled()) return void (out = cancelOutcome())
      const v = guardVerdict(await hostMetrics(), s.preflight)
      if (v.ok) break
      s = await rpc<Settings>("settings")
      const msg = waitingText(v.reason!)
      if (msg !== last) {
        last = msg
        log(msg)
        await rpc("progress", { buildId, status: "waiting", reason: msg })
      }
      if (Date.now() - began > GIVE_UP_MS) return void (out = { status: "failed", reason: `Gave up after ${Math.round(GIVE_UP_MS / 60_000)} minutes: ${msg}`, digest: null })
      for (let t = 0; t < RECHECK_MS; t += 2000) {
        await sleep(Math.min(2000, RECHECK_MS - t))
        if (await cancelled()) break
      }
    }

    const prep = await rpc<Prepared>("prepare", { buildId })
    if (!prep.ok) {
      if (prep.skip) return void (finished = true)
      return void (out = { status: "failed", reason: prep.error, digest: null })
    }
    secretValues.push(prep.token, ...Object.values(prep.secrets))
    if (prep.clone?.token) secretValues.push(prep.clone.token)
    await rpc("progress", { buildId, status: "running", reason: null })
    log(`Building ${prep.name}${prep.ref ? ` from ${prep.refType ?? "ref"} ${prep.ref}` : " from an uploaded folder"}.`)

    await mkdir(join(work, "docker"), { recursive: true, mode: 0o700 })
    // -- source
    let root: string
    let commit = prep.commit
    if (prep.clone) {
      root = join(work, "src")
      log(`Cloning ${prep.clone.url.replace(/\/\/[^@/]*@/, "//")}…`)
      const r = await run("git", ["clone", "--depth", "1", "--single-branch", ...(prep.ref ? ["--branch", prep.ref] : []), "--", prep.clone.url, root], {
        env: await gitEnv(prep.clone, work),
        onLine: log,
      })
      if (r.code !== 0) return void (out = { status: "failed", reason: `Couldn't clone the repository: ${r.out.trim().split("\n").pop() ?? ""}`.slice(0, 300), digest: null })
      commit = (await run("git", ["-C", root, "rev-parse", "HEAD"], { env: baseEnv(work) })).out.trim() || commit
      if (commit) {
        log(`Commit ${commit.slice(0, 7)}.`)
        await rpc("progress", { buildId, status: "running", reason: null, commit })
      }
    } else {
      log("Unpacking the uploaded folder…")
      root = await unpack(prep.tarKey!, work, log)
    }
    const contextDir = await inside(root, prep.rule.context, "The context folder")
    const dockerfile = await inside(root, prep.rule.dockerfile, "The Dockerfile")
    if (!(await stat(dockerfile)).isFile()) throw new Error(`The Dockerfile "${prep.rule.dockerfile}" isn't a file.`)

    // -- registry login for this build only
    const dockerConfig = join(work, "docker")
    const host = prep.image.split("/")[0]
    await writeFile(join(dockerConfig, "config.json"), JSON.stringify({ auths: { [host]: { auth: Buffer.from(`nimbus:${prep.token}`).toString("base64") } } }), { mode: 0o600 })

    // -- buildctl
    const secretEnv = Object.keys(prep.secrets).map((id, i) => ({ id, env: `NIMBUS_SECRET_${i}` }))
    const meta = join(work, "meta.json")
    const args = buildctlArgs({
      addr: buildkit,
      contextDir,
      dockerfileDir: dirname(dockerfile),
      dockerfileName: basename(dockerfile),
      platforms: prep.rule.platforms,
      buildArgs: prep.rule.buildArgs,
      secretEnv,
      image: prep.image,
      insecure: prep.insecure,
      metadataFile: meta,
    })
    const env = { ...baseEnv(work), DOCKER_CONFIG: dockerConfig, ...Object.fromEntries(secretEnv.map((s) => [s.env, prep.secrets[s.id]])) }

    let why: Outcome | null = null
    const abort = (o: Outcome) => {
      if (why) return
      why = o
      stop.abort()
    }
    const timeout = setTimeout(() => abort({ status: "failed", reason: `Timed out after ${prep.timeoutMin} min`, digest: null }), prep.timeoutMin * 60_000)
    // One tick: the cancel flag every 2 s, the RAM/disk guard every 5 s.
    let lastGuard = 0
    const timer = setInterval(async () => {
      if (await cancelled()) return abort(cancelOutcome())
      if (Date.now() - lastGuard < 5000) return
      lastGuard = Date.now()
      const v = guardVerdict(await hostMetrics(), s.guard)
      if (!v.ok) abort({ status: "stopped", reason: `Stopped to protect the server: ${v.reason}`, digest: null })
    }, 2000)

    log("Starting BuildKit…")
    const r = await run("buildctl", args, { env, onLine: log, signal: stop.signal })
    clearTimeout(timeout)
    clearInterval(timer)
    if (why) return void (out = why)
    if (r.code !== 0) return void (out = { status: "failed", reason: failureReason(r.out), digest: null })

    const digest = (JSON.parse(await readFile(meta, "utf8")) as Record<string, string>)["containerimage.digest"]
    if (!digest) return void (out = { status: "failed", reason: "BuildKit finished without an image digest.", digest: null })
    log(`Pushed ${prep.image}@${digest}`)

    // -- scan gate
    if (prep.rule.failOnCritical) {
      await rpc("progress", { buildId, status: "running", reason: "Scanning for vulnerabilities" })
      log("Scanning for vulnerabilities…")
      const sc = await rpc<{ state: string; critical?: number; high?: number; error?: string }>("scan", { buildId, digest }, 12 * 60_000)
      if (sc.state === "done") log(`Scan: ${sc.critical} critical, ${sc.high} high.`)
      if (sc.state === "done" && sc.critical! > 0) return void (out = { status: "failed", reason: `Critical vulnerabilities found (${sc.critical})`, digest })
      if (sc.state === "failed") return void (out = { status: "failed", reason: `The vulnerability scan failed, so the Critical check couldn't run: ${sc.error}`.slice(0, 300), digest })
      // A rule that asks for the check never passes without it.
      if (sc.state === "unavailable") return void (out = { status: "failed", reason: "This rule fails on Critical vulnerabilities, but image scanning isn't turned on.", digest })
    }

    // -- tag
    await rpc("progress", { buildId, status: "running", reason: "Tagging" })
    const t = await rpc<{ tags: string[]; failed?: string }>("tag", { buildId, digest })
    if (t.failed) return void (out = { status: "failed", reason: t.failed, digest })
    tagged = true
    log(`Tagged ${t.tags.map((x) => `${prep.name}:${x}`).join(", ")}`)

    // -- sign
    await rpc("progress", { buildId, status: "running", reason: "Signing" })
    const key = await cosignKey()
    const keyFile = join(work, "cosign.key")
    await writeFile(keyFile, key.key, { mode: 0o600 })
    const sg = await run(
      "cosign",
      ["sign", "--key", keyFile, "--tlog-upload=false", "--yes", ...(prep.insecure ? ["--allow-http-registry", "--allow-insecure-registry"] : []), `${prep.image}@${digest}`],
      { env: { ...baseEnv(work), DOCKER_CONFIG: dockerConfig, COSIGN_PASSWORD: key.password }, onLine: log }
    )
    if (sg.code !== 0) return void (out = { status: "failed", reason: `Pushed and tagged, but signing failed: ${sg.out.trim().split("\n").pop()}`.slice(0, 300), digest })
    log("Signed with the server key.")
    out = { status: "success", reason: null, digest }
  } catch (e) {
    out = { status: "failed", reason: maskLine((e as Error).message, secretValues).slice(0, 300), digest: out.digest }
  } finally {
    stop.abort()
    await rm(work, { recursive: true, force: true }).catch(() => {})
    if (!finished) {
      log(out.status === "success" ? "Build finished." : `Build ${out.status}${out.reason ? `: ${out.reason}` : ""}`)
      await rpc("finish", { buildId, ...out, tagged, reason: out.reason && maskLine(out.reason, secretValues), log: text() }).catch((e) => console.error("[build] finish:", e.message))
    }
    measureCache().catch(() => {})
  }
}

// The last meaningful line buildctl printed ("error: failed to solve: ..."), as the reason.
function failureReason(out: string) {
  const lines = out.trim().split("\n").filter(Boolean)
  const err = [...lines].reverse().find((l) => /error|failed/i.test(l)) ?? lines.at(-1) ?? "BuildKit failed."
  return err.replace(/^.*?(error: )/i, "").slice(0, 300)
}

// ---- cosign key -----------------------------------------------------------------------------------------------------

let cosign: { key: string; password: string } | null = null

async function cosignKey() {
  if (cosign) return cosign
  const have = await rpc<{ key: string; password: string } | null>("cosign-get")
  if (have) return (cosign = have)
  // First use: make the server's key pair (the password is random and stays with the key, sealed by the app).
  const dir = await mkdtemp(join(tmpdir(), "cosign-"))
  const password = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("")
  try {
    const r = await run("cosign", ["generate-key-pair"], { env: { ...baseEnv(dir), COSIGN_PASSWORD: password }, cwd: dir })
    if (r.code !== 0) throw new Error(`cosign generate-key-pair: ${r.out.trim()}`)
    const key = await readFile(join(dir, "cosign.key"), "utf8")
    const pub = await readFile(join(dir, "cosign.pub"), "utf8")
    await rpc("cosign-set", { key, password, pub })
    return (cosign = { key, password })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---- cache numbers and prune ----------------------------------------------------------------------------------------------

async function duTotal() {
  const lines: string[] = []
  const r = await run("buildctl", ["--addr", buildkit, "du", "--format", "{{json .}}"], { env: baseEnv(tmpdir()), onLine: (l) => lines.push(l) })
  if (r.code !== 0) return null
  try {
    const rows = JSON.parse(lines.join("\n")) as { size?: number }[] | null
    return (rows ?? []).reduce((n, x) => n + Number(x.size ?? 0), 0)
  } catch {
    return null
  }
}

async function measureCache() {
  const bytes = await duTotal()
  if (bytes !== null) await redis.set(buildCacheKey, JSON.stringify({ bytes, at: Date.now() }), "EX", 3600)
}

async function prune(id: string) {
  const before = (await duTotal()) ?? 0
  const r = await run("buildctl", ["--addr", buildkit, "prune", "--all"], { env: baseEnv(tmpdir()) })
  const after = (await duTotal()) ?? 0
  await measureCache()
  await redis.set(`registry:build:prune:${id}`, JSON.stringify(r.code === 0 ? { freed: Math.max(0, before - after) } : { error: r.out.trim().split("\n").pop() }), "EX", 300)
}

// ---- schedules ---------------------------------------------------------------------------------------------------------------

type ScheduleInfo = { sourceType: "branch" | "tag"; pattern: string; clone: Clone } | null

async function schedule(ruleId: string) {
  const info = await rpc<ScheduleInfo>("schedule-info", { ruleId })
  if (!info) return
  const dir = await mkdtemp(join(tmpdir(), "ls-remote-"))
  try {
    const lines: string[] = []
    const r = await run("git", ["ls-remote", info.sourceType === "branch" ? "--heads" : "--tags", "--", info.clone.url], { env: await gitEnv(info.clone, dir), onLine: (l) => lines.push(l) })
    if (r.code !== 0) return console.error(`[build] schedule ${ruleId}: ls-remote failed: ${r.out.trim()}`)
    const found = new Map<string, string>()
    for (const l of lines) {
      const [sha, ref] = l.split("\t")
      const p = parseRef(ref?.replace(/\^\{\}$/, "") ?? "")
      if (p && matchRule(info, p)) found.set(p.name, ref.endsWith("^{}") || !found.has(p.name) ? sha : found.get(p.name)!)
    }
    const names = info.sourceType === "tag" ? [latestTag([...found.keys()])].filter((n): n is string => Boolean(n)) : [...found.keys()]
    await rpc("schedule-start", { ruleId, refs: names.map((name) => ({ type: info.sourceType, name, commit: found.get(name) ?? null })) })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---- start ---------------------------------------------------------------------------------------------------------------------------

await mkdir(WORK, { recursive: true })
let settings: Settings | undefined
for (let i = 0; !settings; i++) {
  try {
    settings = await rpc<Settings>("settings", {}, 10_000)
  } catch (e) {
    if (i === 0) console.log(`Waiting for the app at ${app}: ${(e as Error).message}`)
    await sleep(5000)
  }
}
const recovered = await rpc<{ recovered: number }>("recover")
if (recovered.recovered) console.log(`Marked ${recovered.recovered} build(s) from a previous run as failed.`)
await cosignKey().catch((e) => console.error("[build] cosign key:", e.message))

const beat = () => redis.set(buildHeartbeat, String(Date.now()), "EX", 30).catch(() => {})
await beat()
setInterval(beat, 10_000).unref()
measureCache().catch(() => {})
setInterval(() => measureCache().catch(() => {}), 10 * 60_000).unref()

const worker = new Worker(
  BUILDS_QUEUE,
  async (job: Job) => {
    if (job.name === "prune") return prune(job.data.id)
    if (job.name === "schedule") return schedule(job.data.ruleId)
    return runBuild(job.data.buildId)
  },
  { connection: workerConnection(), concurrency: settings.concurrency, lockDuration: 120_000, maxStalledCount: 0 }
)
worker.on("error", (e) => console.error("[build] worker:", e.message))
worker.on("failed", (job, e) => console.error(`[build] job ${job?.id} failed:`, e.message))
console.log(`Build runner up: BuildKit ${buildkit}, ${settings.concurrency} at a time, work in ${WORK}.`)

for (const sig of ["SIGTERM", "SIGINT"] as const)
  process.on(sig, async () => {
    await worker.close()
    process.exit(0)
  })
