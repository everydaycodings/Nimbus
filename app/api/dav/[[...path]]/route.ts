// WebDAV at /dav. Next only routes standard methods, so scripts/webdav.ts
// forwards every request here as a POST carrying the real method, signed so
// nothing else can pose as it.
import { davSignIn } from "@/lib/dav/auth"
import * as dav from "@/lib/dav/handlers"
import { readToken } from "@/lib/upload-rules"

export const dynamic = "force-dynamic"

const realm = { "WWW-Authenticate": 'Basic realm="Nimbus", charset="UTF-8"' }

export async function POST(req: Request) {
  const proof = readToken<{ exp: number }>("dav", req.headers.get("x-dav-proxy"))
  if (!proof || proof.exp < Date.now()) return new Response(null, { status: 404 })
  const method = req.headers.get("x-dav-method")?.toUpperCase() ?? ""
  // Clients ask for options before signing in.
  if (method === "OPTIONS") return dav.options()

  const ip = req.headers.get("x-dav-ip") || null
  const me = await davSignIn(req.headers.get("authorization"), ip)
  if (me === "blocked")
    return new Response("Too many wrong passwords. Try again in 15 minutes.", {
      status: 429,
      headers: { "Retry-After": "900" },
    })
  if (!me) return new Response("Sign in with your email and an app password from Account.", { status: 401, headers: realm })

  let names: string[]
  try {
    names = new URL(req.url).pathname
      .replace(/^\/api\/dav/, "")
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent)
  } catch {
    return new Response(null, { status: 400 })
  }
  const c = { me, names, req }
  switch (method) {
    case "PROPFIND":
      return dav.propfind(c)
    case "PROPPATCH":
      return dav.proppatch(c)
    case "GET":
      return dav.get(c, false)
    case "HEAD":
      return dav.get(c, true)
    case "PUT":
      return dav.put(c)
    case "MKCOL":
      return dav.mkcol(c)
    case "DELETE":
      return dav.remove(c)
    case "MOVE":
      return dav.moveOrCopy(c, false)
    case "COPY":
      return dav.moveOrCopy(c, true)
    case "LOCK":
      return dav.lock(c)
    case "UNLOCK":
      return dav.unlock(c)
    default:
      return new Response(null, { status: 405 })
  }
}
