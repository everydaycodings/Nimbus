// Checks for the bucket settings a member can save (quota, CORS, lifecycle). Pure.
import { prefixError } from "./perms.ts"
import type { CorsRule, LifecycleRule } from "./bucket-config.ts"

export const CORS_METHODS = ["GET", "HEAD", "PUT", "POST", "DELETE"] as const
export const MAX_CORS_RULES = 10
export const MAX_LIFECYCLE_RULES = 20
export const MIN_QUOTA = 1024 ** 2
export const MAX_QUOTA = 1024 ** 5
export const MAX_DAYS = 36_500
const MAX_LIST = 50

const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

export const quotaError = (b: number | null) =>
  b === null || (Number.isInteger(b) && b >= MIN_QUOTA && b <= MAX_QUOTA) ? null : "The limit must be between 1 MB and 1 PB."

// The cleaned rules, or the first problem found.
export function checkCors(rules: CorsRule[]): { rules: CorsRule[] } | { error: string } {
  if (!Array.isArray(rules) || rules.length > MAX_CORS_RULES) return { error: `Use at most ${MAX_CORS_RULES} CORS rules.` }
  const out: CorsRule[] = []
  for (const [i, r] of rules.entries()) {
    const n = `Rule ${i + 1}`
    const lists = [r?.origins, r?.methods, r?.headers ?? [], r?.expose ?? []]
    if (!lists.every((l) => Array.isArray(l) && l.length <= MAX_LIST && l.every((x) => typeof x === "string"))) return { error: `${n} isn't valid.` }
    const origins = [...new Set(r.origins.map((o) => o.trim()))]
    if (!origins.length) return { error: `${n} needs at least one origin.` }
    const bad = origins.find((o) => o !== "*" && !ORIGIN.test(o))
    if (bad) return { error: `${n}: “${bad}” isn't an origin. Use * or something like https://app.example.com, with no path.` }
    const methods = CORS_METHODS.filter((m) => r.methods.includes(m))
    if (!methods.length || methods.length !== new Set(r.methods).size) return { error: `${n} needs methods from ${CORS_METHODS.join(", ")}.` }
    const headers = [...new Set((r.headers ?? []).map((h) => h.trim()))]
    const expose = [...new Set((r.expose ?? []).map((h) => h.trim()))]
    const badHeader = [...headers, ...expose].find((h) => !TOKEN.test(h))
    if (badHeader) return { error: `${n}: “${badHeader}” isn't a header name.` }
    if (expose.includes("*")) return { error: `${n}: list the exposed headers by name.` }
    if (!Number.isInteger(r.maxAgeSeconds) || r.maxAgeSeconds < 0 || r.maxAgeSeconds > 86_400) return { error: `${n}: max age must be 0 to 86400 seconds.` }
    out.push({ origins, methods, headers, expose, maxAgeSeconds: r.maxAgeSeconds })
  }
  return { rules: out }
}

const days = (d: unknown) => d === null || (Number.isInteger(d) && (d as number) >= 1 && (d as number) <= MAX_DAYS)

export function checkLifecycle(rules: LifecycleRule[]): { rules: LifecycleRule[] } | { error: string } {
  if (!Array.isArray(rules) || rules.length > MAX_LIFECYCLE_RULES) return { error: `Use at most ${MAX_LIFECYCLE_RULES} lifecycle rules.` }
  const ids = new Set<string>()
  const out: LifecycleRule[] = []
  for (const [i, r] of rules.entries()) {
    const n = `Rule ${i + 1}`
    const id = typeof r?.id === "string" ? r.id.trim() : ""
    if (!id || id.length > 64) return { error: `${n} needs a name of up to 64 characters.` }
    if (ids.has(id)) return { error: `Two rules are named “${id}”.` }
    ids.add(id)
    const prefix = typeof r.prefix === "string" ? r.prefix : null
    const why = prefix === null ? "That prefix isn't valid." : prefixError(prefix)
    if (why) return { error: `${n}: ${why}` }
    const [expireDays, noncurrentDays, abortMultipartDays] = [r.expireDays ?? null, r.noncurrentDays ?? null, r.abortMultipartDays ?? null]
    if (![expireDays, noncurrentDays, abortMultipartDays].every(days)) return { error: `${n}: days must be whole numbers from 1 to ${MAX_DAYS}.` }
    if (expireDays === null && noncurrentDays === null && abortMultipartDays === null) return { error: `${n} needs at least one action.` }
    out.push({ id, prefix: prefix!, expireDays, noncurrentDays, abortMultipartDays })
  }
  return { rules: out }
}
