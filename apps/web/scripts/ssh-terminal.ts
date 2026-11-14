// Browser SSH terminal: a WebSocket server (default port 3406, path /ssh or /ssh-ws)
// that bridges xterm.js in the browser to a server-side ssh2 shell. Next can't upgrade
// WebSockets, so this runs beside it like scripts/webdav.ts. The browser first asks the
// app for a one-use ticket (unlocked session + role checked there); the ticket holds the
// credentials, sealed in Redis for 60 seconds. Session start/end and first-seen host keys
// go back to the app (/api/ssh-term/event) with a signed header, where they're audited.
// Limits: a browser Origin must be this site's, a socket that sends no ticket in 10 seconds
// is closed, at most SSH_TERMINAL_MAX sessions run at once, and output waits while the
// browser is more than 1 MB behind.
import http from "node:http"

import { Redis } from "ioredis"
import ssh2 from "ssh2"
import { WebSocketServer, type WebSocket } from "ws"

import { TICKET_AAD, openServer } from "../lib/secrets/kms.ts"
import { connectHop, forward, type Hop, type Seen } from "../lib/secrets/ssh-cert-auth.ts"
import { signToken } from "../lib/upload-rules.ts"

const app = new URL(process.env.SSH_TERMINAL_APP_URL ?? process.env.WEBDAV_APP_URL ?? "http://localhost:3000")
const port = Number(process.env.SSH_TERMINAL_PORT ?? 3406)
const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 })
redis.on("error", () => {})
const IDLE_MS = Number(process.env.SSH_TERMINAL_IDLE_MS ?? 30 * 60_000)
const OPEN_MS = 10_000
const MAX = Number(process.env.SSH_TERMINAL_MAX ?? 100)
const HIGH = 1 << 20

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

// A browser always sends Origin: it must be the site (BETTER_AUTH_URL), or the same host
// name as this sidecar (dev, where the page is on :3000 and this on :3406). Other clients
// (no Origin) still need a ticket.
const site = process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL).origin : null
function originOk(origin: string | undefined, host: string | undefined) {
  if (!origin) return true
  try {
    const o = new URL(origin)
    return o.origin === site || (!!host && o.hostname === host.replace(/:\d+$/, "").replace(/^\[|\]$/g, ""))
  } catch {
    return false
  }
}

const server = http.createServer((req, res) => res.writeHead(/^\/ssh(-ws)?$/.test(req.url ?? "") ? 426 : 404).end())
const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 })
server.on("upgrade", (req, socket, head) => {
  if (!/^\/ssh(-ws)?(\?|$)/.test(req.url ?? "")) return socket.destroy()
  if (!originOk(req.headers.origin, req.headers.host)) return socket.end("HTTP/1.1 403 Forbidden\r\n\r\n")
  if (wss.clients.size >= MAX) return socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n")
  wss.handleUpgrade(req, socket, head, (ws) => session(ws, String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "")))
})

const say = (ws: WebSocket, o: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o))
// Terminal sizes from the browser: whole numbers in a sane range.
const dim = (v: unknown, d: number) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 1000 ? (v as number) : d)

function session(ws: WebSocket, ip: string) {
  let t: Ticket | undefined
  let started = 0
  const conns: ssh2.Client[] = []
  let stream: ssh2.ClientChannel | undefined
  let idle: NodeJS.Timeout | undefined
  let ended = false
  // No ticket in time: close, so idle sockets can't pile up.
  const waiting = setTimeout(() => end(), OPEN_MS)
  const end = () => {
    if (ended) return
    ended = true
    clearTimeout(waiting)
    clearTimeout(idle)
    for (const c of conns) c.end()
    if (ws.readyState === ws.OPEN) ws.close()
    if (t && started) event({ event: "end", userId: t.userId, projectId: t.projectId, hostId: t.target.hostId, label: t.label, ip, seconds: (Date.now() - started) / 1000 })
  }
  // The socket closed while a hop was still connecting: close what opened since.
  const drop = () => {
    for (const c of conns) c.end()
    end()
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
  // Browser output: past HIGH bytes queued, the shell waits until the browser catches up.
  const out = (d: Buffer) => {
    if (ws.readyState !== ws.OPEN) return
    ws.send(d, { binary: true })
    if (ws.bufferedAmount > HIGH && stream && !stream.isPaused()) {
      stream.pause()
      const iv = setInterval(() => {
        if (ended || ws.bufferedAmount < HIGH / 4) {
          clearInterval(iv)
          stream?.resume()
        }
      }, 50)
    }
  }

  // Anything thrown ends this session only (an unhandled rejection would stop the sidecar).
  ws.on("message", (data, isBinary) => {
    onMessage(data as Buffer, isBinary).catch((e) => refuse(e instanceof Error ? e.message : "The terminal failed."))
  })
  async function onMessage(data: Buffer, isBinary: boolean) {
    if (isBinary) {
      if (!stream) return
      stream.write(data)
      return bump()
    }
    let m: unknown
    try {
      m = JSON.parse(String(data))
    } catch {
      return
    }
    if (!m || typeof m !== "object") return
    const msg = m as { type?: unknown; ticket?: unknown; cols?: unknown; rows?: unknown }
    if (msg.type === "resize") return void stream?.setWindow(dim(msg.rows, 24), dim(msg.cols, 80), 0, 0)
    if (msg.type !== "open" || t || typeof msg.ticket !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(msg.ticket)) return
    clearTimeout(waiting)
    const raw = await redis.getdel(`ssh:ticket:${msg.ticket}`).catch(() => null)
    if (!raw) return refuse("That terminal link expired. Try again.")
    try {
      t = JSON.parse(openServer(raw, TICKET_AAD)) as Ticket
    } catch {
      return refuse("That terminal link isn't valid.")
    }
    const tk = t
    const cols = dim(msg.cols, 80)
    const rows = dim(msg.rows, 24)
    const seenJ: Seen = {}
    const seenT: Seen = {}
    try {
      let sock: import("node:stream").Duplex | undefined
      if (tk.jump) {
        say(ws, { type: "status", message: `Connecting to ${tk.jump.host}…` })
        const j = await connectHop(tk.jump, undefined, seenJ)
        conns.push(j)
        if (!tk.jump.hostKey && seenJ.key) event({ event: "pin", userId: tk.userId, projectId: tk.projectId, hostId: tk.jump.hostId, label: tk.label, key: seenJ.key })
        if (ended) return drop()
        sock = await forward(j, tk.target.host, tk.target.port)
      }
      if (ended) return drop()
      say(ws, { type: "status", message: `Connecting to ${tk.label}…` })
      const c = await connectHop(tk.target, sock, seenT)
      conns.push(c)
      if (!tk.target.hostKey && seenT.key) event({ event: "pin", userId: tk.userId, projectId: tk.projectId, hostId: tk.target.hostId, label: tk.label, key: seenT.key })
      if (ended || ws.readyState !== ws.OPEN) return drop()
      stream = await new Promise<ssh2.ClientChannel>((res, rej) =>
        c.shell({ term: "xterm-256color", cols, rows }, (e, s) => (e ? rej(e) : res(s)))
      )
      started = Date.now()
      event({ event: "start", userId: tk.userId, projectId: tk.projectId, hostId: tk.target.hostId, label: tk.label, ip })
      say(ws, { type: "ready" })
      bump()
      stream.on("data", out)
      stream.stderr.on("data", out)
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
  }
}

server.listen(port, () => console.log(`SSH terminal on :${port}/ssh → ${app.origin}`))
