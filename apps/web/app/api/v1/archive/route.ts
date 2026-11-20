// POST /api/v1/archive {url, tags?}: saves a page to the Website Archiver and captures it now.
// Signed in with HTTP Basic: the account's email and an app password (Account → Connect), a read-only one refused.
// For scripts, browser extensions and share sheets; the bookmarklet uses the page at /more/archive/add instead.
import { z } from "zod"

import { addPages } from "@/lib/archive/run"
import { cleanUrl } from "@/lib/archive/rules"
import { appPasswordAuth } from "@/lib/dav/auth"
import { clientIp } from "@/lib/secrets/token-rules"
import { getSettings } from "@/lib/signup"

export const dynamic = "force-dynamic"

const err = (status: number, error: string, message: string, headers?: HeadersInit) => Response.json({ error, message }, { status, headers })

const Body = z.object({ url: z.string().min(1).max(2048), tags: z.array(z.string().max(60)).max(20).optional() })

export async function POST(req: Request) {
  const me = await appPasswordAuth(req.headers.get("authorization"), clientIp(req))
  if (me === "blocked") return err(429, "rate_limited", "Too many wrong passwords. Try again in 15 minutes.", { "Retry-After": "900" })
  if (!me) return err(401, "signed-out", "Sign in with your email and an app password from Account.", { "WWW-Authenticate": 'Basic realm="Nimbus", charset="UTF-8"' })
  if (me.readOnly) return err(403, "forbidden", "This app password is read-only.")
  if (!(await getSettings()).archiverToolEnabled) return err(404, "not-found", "The website archive is turned off on this server.")

  const body = Body.safeParse(await req.json().catch(() => null))
  if (!body.success) return err(400, "bad-request", 'Send JSON like {"url": "https://example.com", "tags": ["read"]}.')
  const url = cleanUrl(body.data.url)
  if (!url) return err(400, "bad-request", "That isn't a web address (http or https).")

  const r = await addPages(me.id, [{ url }], { tags: body.data.tags })
  if (r.error) return err(400, "refused", r.error)
  // Already saved: the page is captured again, and the answer says it was there.
  return Response.json({ url, added: r.added === 1 }, { status: r.added ? 201 : 200 })
}
