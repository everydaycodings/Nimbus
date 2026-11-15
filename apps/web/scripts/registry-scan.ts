// The image scanner (docker/registry-scan, profile "scan"): a tiny HTTP server in front of Trivy.
// POST /scan {ref, username, password, insecure?} with the x-scan-secret header answers with
// Trivy's JSON report, with the full package list (--list-all-pkgs, licenses where the package database has
// them; the heavy license scanner isn't run). {remote: true} scans a public image without credentials
// (base-image advice), at most REMOTE_WAITING at once. One scan at a time. Only the app and worker can reach it (no host port).
// Plain node, no imports from the app: it runs next to Trivy in its own image.
import { spawn } from "node:child_process"
import { timingSafeEqual } from "node:crypto"
import http from "node:http"

const port = Number(process.env.REGISTRY_SCAN_PORT ?? 4954)
const secret = process.env.REGISTRY_SCAN_SECRET ?? ""
if (!secret) throw new Error("REGISTRY_SCAN_SECRET isn't set.")

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

const REMOTE_WAITING = 3
let remoteWaiting = 0

function trivy(b: { ref: string; username: string; password: string; insecure?: boolean; remote?: boolean }) {
  return new Promise<string>((resolve, reject) => {
    // Credentials go in the environment, not the command line.
    const p = spawn(
      "trivy",
      ["image", "--format", "json", "--quiet", "--scanners", "vuln", "--list-all-pkgs", ...(b.insecure ? ["--insecure"] : []), b.ref],
      { env: { ...process.env, ...(!b.remote && { TRIVY_USERNAME: b.username, TRIVY_PASSWORD: b.password }) } }
    )
    let out = ""
    let err = ""
    p.stdout.on("data", (d) => (out += d))
    p.stderr.on("data", (d) => (err = (err + d).slice(-2000)))
    const timer = setTimeout(() => p.kill("SIGKILL"), 9 * 60_000)
    p.on("error", reject)
    p.on("close", (code) => {
      clearTimeout(timer)
      code === 0 ? resolve(out) : reject(new Error(err.trim().split("\n").slice(-3).join(" ") || `trivy exited with ${code}`))
    })
  })
}

// ponytail: one scan at a time; add a pool if scan latency matters.
let queue: Promise<unknown> = Promise.resolve()

http
  .createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") return void res.writeHead(200).end("ok")
    if (req.method !== "POST" || req.url !== "/scan") return void res.writeHead(404).end()
    if (!same(String(req.headers["x-scan-secret"] ?? ""), secret)) return void res.writeHead(401).end()
    let raw = ""
    for await (const c of req) if ((raw += c).length > 10_000) return void res.writeHead(413).end()
    try {
      const b = JSON.parse(raw)
      const remote = b.remote === true
      if (typeof b.ref !== "string" || !b.ref || b.ref.startsWith("-") || (!remote && typeof b.password !== "string")) throw new Error("ref and password are required.")
      if (remote && (!/^[a-z0-9][a-z0-9._:\/@-]{0,300}$/i.test(b.ref) || b.insecure)) throw new Error("That isn't an image reference.")
      if (remote && remoteWaiting >= REMOTE_WAITING) return void res.writeHead(429, { "content-type": "text/plain" }).end("The scanner is busy with other remote scans.")
      if (remote) remoteWaiting++
      const run = queue.then(() => trivy({ ref: b.ref, username: String(b.username ?? ""), password: String(b.password ?? ""), insecure: Boolean(b.insecure), remote }))
      queue = run.catch(() => {})
      const out = await run.finally(() => remote && remoteWaiting--)
      res.writeHead(200, { "content-type": "application/json" }).end(out)
    } catch (e) {
      res.writeHead(502, { "content-type": "text/plain" }).end((e as Error).message)
    }
  })
  .listen(port, () => console.log(`Scanner on :${port}`))
