// Pure container registry rules shared by the protocol (lib/registry) and the web pages.
// Relative-import safe, so node --test can load it.
import { randomBytes, randomInt } from "node:crypto"

export const TOKEN_PREFIX = "NMCR"
export const RESERVED = ["mirror", "v2", "token", "library", "admin"]
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
export const TRASH_DAYS = 7
export const GC_GRACE_HOURS = 24
export const EXPIRY_DAYS = [30, 90, 365] as const

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

// id (NMCR + 16 chars, the lookup part) plus a 40-char secret; clients send `${id}${secret}`.
export function newToken() {
  let id = TOKEN_PREFIX
  while (id.length < 20) id += UPPER[randomInt(UPPER.length)]
  const secret = randomBytes(30).toString("base64").replace(/\+/g, "A").replace(/\//g, "B")
  return { prefix: id, secret, token: `${id}${secret}` }
}

// The id is fixed-width, so a presented token splits without a separator.
export function splitToken(t: string) {
  return t.startsWith(TOKEN_PREFIX) && t.length > 20 ? { prefix: t.slice(0, 20), secret: t.slice(20) } : null
}

const COMPONENT = /^[a-z0-9]+(?:(?:\.|_|__|-+)[a-z0-9]+)*$/
export const TAG_RE = /^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$/

// distribution-spec repository name: components joined by "/", at most 255 characters.
export function validRepoName(name: string) {
  return name.length > 0 && name.length <= 255 && name.split("/").every((c) => COMPONENT.test(c))
}

export function validTag(tag: string) {
  return TAG_RE.test(tag)
}

// "<namespace>/<repo...>" -> parts. Null when there's no repo part or either is invalid.
export function splitName(path: string): { namespace: string; repo: string } | null {
  const i = path.indexOf("/")
  if (i < 1) return null
  const namespace = path.slice(0, i)
  const repo = path.slice(i + 1)
  if (!COMPONENT.test(namespace) || !validRepoName(repo)) return null
  return { namespace, repo }
}

// A registry name (user or org namespace): one path component, 2–39 chars, not reserved.
export function registryNameError(name: string): string | null {
  if (name.length < 2 || name.length > 39) return "Registry names are 2 to 39 characters."
  if (name !== name.toLowerCase() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    return "Use lowercase letters, numbers and single hyphens, starting and ending with a letter or number."
  if (RESERVED.includes(name)) return "That name is reserved."
  return null
}

// "sha256:<64 hex>" or "sha512:<128 hex>".
export function parseDigest(d: string): { algo: "sha256" | "sha512"; hex: string } | null {
  const m = /^(sha256|sha512):([a-f0-9]+)$/.exec(d)
  if (!m) return null
  const algo = m[1] as "sha256" | "sha512"
  return m[2].length === (algo === "sha256" ? 64 : 128) ? { algo, hex: m[2] } : null
}

// Uploads only accept sha256.
export function validUploadDigest(d: string) {
  return parseDigest(d)?.algo === "sha256"
}

// A manifest reference is a tag or a digest.
export function validReference(ref: string) {
  return validTag(ref) || parseDigest(ref) !== null
}

// The host clients use, or null when setup didn't turn the registry on.
export function endpoint(env: Record<string, string | undefined> = process.env) {
  const d = env.REGISTRY_DOMAIN?.trim()
  if (!d) return null
  const h = d.replace(/\/+$/, "")
  return /^https?:\/\//.test(h) ? h : `https://${h}`
}

// Immutable-tag pattern: "re:<regex>" is a regex, anything else a glob where * matches
// any characters and ? one. Comma separated alternatives are allowed in globs.
export function matchPattern(pattern: string, tag: string): boolean {
  const p = pattern.trim()
  if (!p) return false
  if (p.startsWith("re:")) {
    try {
      return new RegExp(p.slice(3)).test(tag)
    } catch {
      return false
    }
  }
  return p.split(",").some((g) => {
    const re = g.trim().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
    return g.trim() !== "" && new RegExp(`^${re}$`).test(tag)
  })
}

// Cleanup policy. Every part is optional. Keep rules win over delete rules.
export type Policy = {
  // Keep the newest N tags (by pushedAt).
  keepLast?: number
  // Delete untagged manifests older than N days (see untaggedToDelete).
  untaggedDays?: number
  // Tags matching a pattern (matchPattern) are kept / deleted.
  keepPattern?: string
  deletePattern?: string
  // Delete tags not pulled for N days (pushedAt when never pulled).
  notPulledDays?: number
  // Delete tags pushed more than N days ago (Registry Cleanup rules).
  olderThanDays?: number
  // Regex (case-sensitive, on the tag name): matching tags are never deleted and don't count toward keepLast.
  keepRegex?: string
}

export type PolicyTag = { name: string; pushedAt: Date; lastPulledAt: Date | null }

const DAY = 86_400_000

// Names of the tags the policy would delete. A tag is deleted when a delete rule
// (deletePattern, notPulledDays) selects it and no keep rule (keepLast, keepPattern) does.
export function evaluatePolicy(policy: Policy, tags: PolicyTag[], now: Date = new Date()): string[] {
  const keep = new Set<string>()
  if (policy.keepLast && policy.keepLast > 0)
    [...tags]
      .sort((a, b) => b.pushedAt.getTime() - a.pushedAt.getTime())
      .slice(0, policy.keepLast)
      .forEach((t) => keep.add(t.name))
  if (policy.keepPattern) for (const t of tags) if (matchPattern(policy.keepPattern, t.name)) keep.add(t.name)
  const out: string[] = []
  for (const t of tags) {
    if (keep.has(t.name)) continue
    const byPattern = !!policy.deletePattern && matchPattern(policy.deletePattern, t.name)
    const idle = (t.lastPulledAt ?? t.pushedAt).getTime()
    const stale = !!policy.notPulledDays && now.getTime() - idle > policy.notPulledDays * DAY
    const old = !!policy.olderThanDays && now.getTime() - t.pushedAt.getTime() > policy.olderThanDays * DAY
    if (byPattern || stale || old) out.push(t.name)
  }
  return out
}

// Untagged manifests (digests) older than untaggedDays, for the policy's untagged rule.
export function untaggedToDelete(
  policy: Policy,
  manifests: { digest: string; createdAt: Date; tagged: boolean }[],
  now: Date = new Date()
): string[] {
  if (!policy.untaggedDays) return []
  return manifests
    .filter((m) => !m.tagged && now.getTime() - m.createdAt.getTime() > policy.untaggedDays! * DAY)
    .map((m) => m.digest)
}

export type Role = "read" | "write" | "admin" | "owner"
const RANK: Record<Role, number> = { read: 1, write: 2, admin: 3, owner: 4 }

// The highest of several roles (nulls are "no role"); null when there are none.
export function maxRole(...roles: (Role | null | undefined)[]): Role | null {
  let best: Role | null = null
  for (const r of roles) if (r && (!best || RANK[r] > RANK[best])) best = r
  return best
}

export const atLeast = (role: Role | null, min: Role) => !!role && RANK[role] >= RANK[min]

// What a token scope allows: push includes pull, delete includes push.
export function scopeAllows(access: "pull" | "push" | "delete", op: "pull" | "push" | "delete") {
  return op === "pull" || (op === "push" && access !== "pull") || access === "delete"
}

// How long a renamed repo's old name keeps answering reads.
export const ALIAS_DAYS = 30
export const EVENT_DAYS = 90
export const DESCRIPTION_MAX = 100
