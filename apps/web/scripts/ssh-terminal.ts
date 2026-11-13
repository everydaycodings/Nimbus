// Browser SSH terminal: a WebSocket server (default port 3406, path /ssh or /ssh-ws)
// that bridges xterm.js in the browser to a server-side ssh2 shell. Next can't upgrade
// WebSockets, so this runs beside it like scripts/webdav.ts. The browser first asks the
// app for a one-use ticket (unlocked session + role checked there); the ticket holds the
// credentials, sealed in Redis for 60 seconds. Session start/end and first-seen host keys
// go back to the app (/api/ssh-term/event) with a signed header, where they're audited.
import { createHash } from "node:crypto"
import http from "node:http"

import { Redis } from "ioredis"
import ssh2 from "ssh2"
import { WebSocketServer, type WebSocket } from "ws"

import { openServer } from "../lib/secrets/kms.ts"
import { makeCertKey } from "../lib/secrets/ssh-cert-auth.ts"
import { signToken } from "../lib/upload-rules.ts"

const { Client } = ssh2
const app = new URL(process.env.SSH_TERMINAL_APP_URL ?? process.env.WEBDAV_APP_URL ?? "http://localhost:3000")
const port = Number(process.env.SSH_TERMINAL_PORT ?? 3406)
const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 })
redis.on("error", () => {})
const IDLE_MS = Number(process.env.SSH_TERMINAL_IDLE_MS ?? 30 * 60_000)

type Hop = { host: string; port: number; username: string; hostId: string; hostKey: string | null; privateKey: string; passphrase?: string; certificate?: string }
type Ticket = { userId: string; projectId: string; label: string; target: Hop; jump?: Hop }

async function event(body: object) {
  try {
    const r = await fetch(new URL("/api/ssh-term/event", app), {
      method: "POST",
      headers: { "content-type": "application/json", "x-ssh-term": signToken("ssh-term", {}, 60_000) },
      body: JSON.stringify(body),
    })
    if (!r.ok) console.error(`event ${(body as { event?: string }).event} refused: HTTP ${r.status}`)
  } catch (e) {
    console.error("event failed:", (e as Error).message)
  }
}

const server = http.createServer((req, res) => res.writeHead(/^\/ssh(-ws)?$/.test(req.url ?? "") ? 426 : 404).end())
const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 })
server.on("upgrade", (req, socket, head) => {
  if (!/^\/ssh(-ws)?(\?|$)/.test(req.url ?? "")) return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => session(ws, String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "")))
})

const say = (ws: WebSocket, o: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o))

// Opens one hop. A pinned host key must match; the first one seen is reported to be pinned.
function connect(h: Hop, sock: import("node:stream").Duplex | undefined, seen: { key?: string; mismatch?: boolean }) {
  return new Promise<InstanceType<typeof Client>>((resolve, reject) => {
    const c = new Client()
    c.on("ready", () => resolve(c)).on("error", reject)
    c.connect({
      host: h.host,
      port: h.port,
      username: h.username,
      sock,
      readyTimeout: 15_000,
      keepaliveInterval: 20_000,
      ...(h.certificate
        ? { authHandler: [{ type: "publickey" as const, username: h.username, key: makeCertKey(h.privateKey, h.passphrase, h.certificate) }] as unknown as ssh2.AuthenticationType[] }
        : { privateKey: h.privateKey, passphrase: h.passphrase }),
      hostVerifier: (key: Buffer) => {
        seen.key = createHash("sha256").update(key).digest("base64")
        if (h.hostKey && h.hostKey !== seen.key) return (seen.mismatch = true), false
        return true
      },
    })
  })
}

function session(ws: WebSocket, ip: string) {
  let t: Ticket | undefined
  let started = 0
  const conns: InstanceType<typeof Client>[] = []
  let stream: ssh2.ClientChannel | undefined
  let idle: NodeJS.Timeout | undefined
  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    clearTimeout(idle)
    for (const c of conns) c.end()
    if (ws.readyState === ws.OPEN) ws.close()
    if (t && started) event({ event: "end", userId: t.userId, projectId: t.projectId, hostId: t.target.hostId, label: t.label, ip, seconds: (Date.now() - started) / 1000 })
  }
  const bump = () => {
    clearTimeout(idle)
    idle = setTimeout(() => {
      say(ws, { type: "error", message: "Closed after 30 minutes without typing." })
      end()
    }, IDLE_MS)
  }
  const refuse = (message: string) => {
    say(ws, { type: "error", message })
    if (t) event({ event: "refused", userId: t.userId, projectId: t.projectId, hostId: t.target.hostId, label: t.label, ip, message })
    end()
  }

  ws.on("close", end)
  ws.on("error", end)
  ws.on("message", async (data, isBinary) => {
    if (isBinary) {
      stream?.write(data as Buffer)
      return bump()
    }
    let m: { type?: string; ticket?: string; cols?: number; rows?: number }
    try {
      m = JSON.parse(String(data))
    } catch {
      return
    }
    if (m.type === "resize") return void stream?.setWindow(m.rows ?? 24, m.cols ?? 80, 0, 0)
    if (m.type !== "open" || t || !m.ticket) return
    const raw = await redis.getdel(`ssh:ticket:${m.ticket}`).catch(() => null)
    if (!raw) return refuse("That terminal link expired. Try again.")
    try {
      t = JSON.parse(openServer(raw)) as Ticket
    } catch {
      return refuse("That terminal link isn't valid.")
    }
    const tk = t
    const cols = m.cols ?? 80
    const rows = m.rows ?? 24
    const seenJ: { key?: string; mismatch?: boolean } = {}
    const seenT: { key?: string; mismatch?: boolean } = {}
    try {
      let sock: import("node:stream").Duplex | undefined
      if (tk.jump) {
        say(ws, { type: "status", message: `Connecting to ${tk.jump.host}…` })
        const j = await connect(tk.jump, undefined, seenJ)
        conns.push(j)
        if (!tk.jump.hostKey && seenJ.key) event({ event: "pin", userId: tk.userId, projectId: tk.projectId, hostId: tk.jump.hostId, label: tk.label, key: seenJ.key })
        sock = await new Promise<import("node:stream").Duplex>((res, rej) =>
          j.forwardOut("127.0.0.1", 0, tk.target.host, tk.target.port, (e, s) => (e ? rej(e) : res(s)))
        )
      }
      say(ws, { type: "status", message: `Connecting to ${tk.label}…` })
      const c = await connect(tk.target, sock, seenT)
      conns.push(c)
      if (!tk.target.hostKey && seenT.key) event({ event: "pin", userId: tk.userId, projectId: tk.projectId, hostId: tk.target.hostId, label: tk.label, key: seenT.key })
      if (ws.readyState !== ws.OPEN) return end()
      stream = await new Promise<ssh2.ClientChannel>((res, rej) =>
        c.shell({ term: "xterm-256color", cols, rows }, (e, s) => (e ? rej(e) : res(s)))
      )
      started = Date.now()
      event({ event: "start", userId: tk.userId, projectId: tk.projectId, hostId: tk.target.hostId, label: tk.label, ip })
      say(ws, { type: "ready" })
      bump()
      stream.on("data", (d: Buffer) => ws.readyState === ws.OPEN && ws.send(d, { binary: true }))
      stream.stderr.on("data", (d: Buffer) => ws.readyState === ws.OPEN && ws.send(d, { binary: true }))
      stream.on("close", () => {
        say(ws, { type: "exit" })
        end()
      })
    } catch (e) {
      const mismatch = seenJ.mismatch || seenT.mismatch
      refuse(
        mismatch
          ? "The server's host key changed. If that's expected, edit the host and tick “Trust a new host key”."
          : /authentication/i.test((e as Error).message)
            ? "The server refused the key or certificate."
            : (e as Error).message
      )
    }
  })
}

server.listen(port, () => console.log(`SSH terminal on :${port}/ssh → ${app.origin}`))
