// The server's side of the password check: asks api.pwnedpasswords.com for one hash
// prefix. Never throws; "unavailable" is a normal answer (offline, rate limited, slow).
import { createHash } from "node:crypto"

import { matchRange } from "./pwned-rules.ts"

const URL_BASE = "https://api.pwnedpasswords.com/range/"

// The lines for a prefix, padding removed, or null when the service can't be reached.
export async function fetchRange(prefix: string, f: typeof fetch = fetch): Promise<string | null> {
  if (!/^[0-9A-F]{5}$/i.test(prefix)) return null
  try {
    const res = await f(URL_BASE + prefix.toUpperCase(), {
      headers: { "Add-Padding": "true", "User-Agent": "nimbus-secrets" },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    return (await res.text())
      .split(/\r?\n/)
      .filter((l) => /^[0-9A-F]{35}:\d+$/i.test(l.trim()) && Number(l.split(":")[1]) > 0)
      .join("\n")
  } catch {
    return null
  }
}

// How many breaches hold this password; null when the check couldn't run.
export async function pwnedCount(password: string, f: typeof fetch = fetch) {
  const h = createHash("sha1").update(password).digest("hex").toUpperCase()
  const range = await fetchRange(h.slice(0, 5), f)
  return range === null ? null : matchRange(range, h.slice(5))
}
