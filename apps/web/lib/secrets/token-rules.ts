// Pure rules for Secrets tokens: generating, hashing, IP allowlists and folder scope.
// Run: node --test lib/secrets/token-rules.test.ts
import { createHash, randomBytes } from "node:crypto"
import { ipFrom } from "../client-ip.ts"

export const MACHINE_PREFIX = "nms_"
export const CLI_PREFIX = "nmu_"

export const newToken = (prefix: string) => prefix + randomBytes(24).toString("base64url")
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex")

// "/app/api/" and "app/api" are the same folder; "/" and "" are the root.
export const normPath = (p: string) => p.split("/").filter(Boolean).join("/")

// A token scoped to `scope` (a folder path) may read `want` and anything under it.
export const pathInScope = (scope: string, want: string) => {
  const s = normPath(scope)
  const w = normPath(want)
  return s === "" || w === s || w.startsWith(`${s}/`)
}

const v4 = (ip: string) => {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m || m.slice(1).some((n) => Number(n) > 255)) return null
  return ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0
}
const bare = (ip: string) => ip.trim().replace(/^::ffff:/i, "")

// An entry is an IP or an IPv4 CIDR like 10.0.0.0/8. Null when it's neither.
export function validIpEntry(e: string) {
  const [ip, bits, extra] = e.trim().split("/")
  if (extra !== undefined) return false
  if (v4(ip) !== null) return bits === undefined || (/^\d+$/.test(bits) && Number(bits) <= 32)
  return bits === undefined && /^[0-9a-f:]+$/i.test(ip) && ip.includes(":")
}

export function ipAllowed(list: string[] | null, ip: string | null) {
  if (!list || !list.length) return true
  if (!ip) return false
  const addr = bare(ip)
  const n = v4(addr)
  return list.some((e) => {
    const [base, bits] = e.trim().split("/")
    if (bits === undefined || v4(base) === null) return bare(base).toLowerCase() === addr.toLowerCase()
    if (n === null) return false
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0
    return ((v4(base)! & mask) >>> 0) === ((n & mask) >>> 0)
  })
}

// The address the nearest proxy saw. nginx (production_script) sets X-Real-IP to it and
// appends it to X-Forwarded-For, so the first XFF entry is whatever the caller sent and
// can't gate an IP allowlist; the last one is the proxy's.
export const clientIp = (req: Request) => ipFrom(req.headers)
