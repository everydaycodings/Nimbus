import { fail } from "@/lib/api"
import { projectRoute } from "@/lib/secrets/guard"
import { terminalTicket } from "@/lib/secrets/ssh"

type P = { hostId: string }

// Where the browser should open the WebSocket: SSH_TERMINAL_URL, else the sidecar's
// port on the same machine (dev), else /ssh-ws on the same site (behind nginx).
function wsUrl(req: Request) {
  const set = process.env.SSH_TERMINAL_URL
  if (set) return set
  const u = new URL(req.url)
  const h = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host
  const host = h.replace(/:\d+$/, "")
  const secure = (req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "")) === "https"
  if (/^(localhost|127\.|\[::1\]|\d+\.\d+\.\d+\.\d+$)/.test(host) && !secure) return `ws://${host}:${process.env.SSH_TERMINAL_PORT ?? 3406}/ssh`
  return `${secure ? "wss" : "ws"}://${h}/ssh-ws`
}

// A one-use ticket for the terminal sidecar. Needs an unlocked session (guard) and a role above Viewer.
export const POST = projectRoute<P>("developer", async (c, req, p) => {
  const me = c.userId
  const t = await terminalTicket(c, me, p.hostId)
  if (!t) return fail(500, "no-ticket", "Couldn't start the terminal.")
  return Response.json({ ...t, url: wsUrl(req) })
})
