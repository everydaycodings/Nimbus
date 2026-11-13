import { db } from "@/lib/db"
import { settings } from "@/lib/db/schema"
import { withSecrets } from "@/lib/secrets/guard"
import { fetchRange } from "@/lib/secrets/pwned"

// GET /pwned?prefix=5BAA6: the Have I Been Pwned range for a SHA-1 prefix. The browser
// hashes the password and compares the suffix itself, so the value never leaves it.
// { ok: false } when an admin turned the check off or the service can't be reached.
export const GET = (req: Request) =>
  withSecrets(async () => {
    const prefix = new URL(req.url).searchParams.get("prefix") ?? ""
    const [s] = await db.select({ on: settings.secretHibp }).from(settings)
    if (s && !s.on) return Response.json({ ok: false, disabled: true })
    const range = await fetchRange(prefix)
    return Response.json(range === null ? { ok: false } : { ok: true, range }, { headers: { "cache-control": "no-store" } })
  })
