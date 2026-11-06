import { withMember } from "@/lib/api"
import { listen } from "@/lib/events"

export const dynamic = "force-dynamic"

// Server-Sent Events: `notification` with {id} whenever the bell gets a row for
// this member, and a ping comment every 25 seconds so proxies keep it open.
export const GET = (req: Request) =>
  withMember(async (me) => {
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
        const off = listen(me.id, (id) =>
          write(`event: notification\ndata: ${JSON.stringify({ id })}\n\n`)
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
  })
