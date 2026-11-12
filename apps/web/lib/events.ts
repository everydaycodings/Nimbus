// Live "something new" pings for the Android app's built-in connection (GET /api/v1/events).
// notify() publishes to Redis so any server process can reach the person's open streams.
// A key is a user id, or "node:<id>" for a file's comments.
import { redis } from "@/lib/redis"

const channel = (userId: string) => `events:${userId}`

export const publishEvent = (userId: string, id: string) =>
  redis.publish(channel(userId), id).catch(() => {})

const globalForEvents = globalThis as unknown as {
  eventListeners?: Map<string, Set<(id: string) => void>>
  eventSub?: ReturnType<typeof redis.duplicate>
}
const listeners = (globalForEvents.eventListeners ??= new Map())

// One subscriber connection per process, made on first use.
function sub() {
  if (!globalForEvents.eventSub) {
    const s = redis.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null })
    s.on("error", () => {})
    s.on("message", (ch, id) => {
      listeners.get(ch.slice("events:".length))?.forEach((send: (id: string) => void) => send(id))
    })
    globalForEvents.eventSub = s
  }
  return globalForEvents.eventSub
}

// Calls `send(notificationId)` until the returned function is called.
export function listen(userId: string, send: (id: string) => void) {
  let set = listeners.get(userId)
  if (!set) {
    listeners.set(userId, (set = new Set()))
    sub().subscribe(channel(userId)).catch(() => {})
  }
  set.add(send)
  return () => {
    set.delete(send)
    if (!set.size) {
      listeners.delete(userId)
      sub().unsubscribe(channel(userId)).catch(() => {})
    }
  }
}

// Server-Sent Events: `event` with {id} for each publish to `key`, and a ping comment every 25
// seconds so proxies keep it open.
export function eventStream(req: Request, key: string, event: string) {
  const enc = new TextEncoder()
  let stop = () => {}
  const body = new ReadableStream({
    start(controller) {
      const write = (s: string) => {
        try {
          controller.enqueue(enc.encode(s))
        } catch {
          stop()
        }
      }
      const off = listen(key, (id) =>
        write(`event: ${event}\ndata: ${JSON.stringify({ id })}\n\n`)
      )
      const timer = setInterval(() => write(": ping\n\n"), 25_000)
      stop = () => {
        clearInterval(timer)
        off()
        try {
          controller.close()
        } catch {}
      }
      req.signal.addEventListener("abort", stop)
      write("retry: 10000\n\n")
    },
    cancel: () => stop(),
  })
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    },
  })
}
