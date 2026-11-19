// IPv4 and IPv6 addresses and CIDR ranges, for a key's allowed-IP list. Pure, so pages can validate too.

const [B0, B8, B16, B32] = [BigInt(0), BigInt(8), BigInt(16), BigInt(32)]
const [FFFF, FFFF_FFFF] = [BigInt(0xffff), BigInt(0xffffffff)]

type Ip = { bits: 32 | 128; n: bigint }

function parseIp(raw: string): Ip | null {
  let s = raw.trim()
  const v4 = (t: string) => {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) return null
    const p = t.split(".").map(Number)
    return p.some((x) => x > 255) ? null : p.reduce((a, x) => (a << B8) + BigInt(x), B0)
  }
  const plain = v4(s)
  if (plain !== null) return { bits: 32, n: plain }
  if (!s.includes(":") || !/^[0-9a-f:.]+$/i.test(s)) return null
  const tail = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (tail) {
    const t = v4(tail[2])
    if (t === null) return null
    s = `${tail[1]}${(t >> B16).toString(16)}:${(t & FFFF).toString(16)}`
  }
  const halves = s.split("::")
  if (halves.length > 2) return null
  const side = (h: string) => (h ? h.split(":") : [])
  const [a, b] = [side(halves[0]), side(halves[1] ?? "")]
  const gap = 8 - a.length - b.length
  if (halves.length === 2 ? gap < 1 : gap !== 0) return null
  const groups = [...a, ...Array<string>(halves.length === 2 ? gap : 0).fill("0"), ...b]
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null
  const n = groups.reduce((acc, g) => (acc << B16) + BigInt(parseInt(g, 16)), B0)
  // ::ffff:1.2.3.4 is the IPv4 address 1.2.3.4.
  return n >> B32 === FFFF ? { bits: 32, n: n & FFFF_FFFF } : { bits: 128, n }
}

function parseRange(raw: string) {
  const [addr, len, ...extra] = raw.trim().split("/")
  const ip = parseIp(addr)
  if (!ip || extra.length || (len !== undefined && !/^\d{1,3}$/.test(len))) return null
  // A mapped IPv6 range keeps its own length, so shift it to the IPv4 scale.
  const mapped = ip.bits === 32 && addr.includes(":")
  const bits = len === undefined ? ip.bits : Number(len) - (mapped ? 96 : 0)
  return bits < 0 || bits > ip.bits ? null : { ip, bits }
}

// Why a list entry isn't an address or range, or null when it is.
export const cidrError = (s: string) => (parseRange(s) ? null : `“${s.trim()}” isn't an IP address or range like 203.0.113.0/24.`)

export function ipAllowed(ip: string | null, list: string[] | null | undefined) {
  if (!list?.length) return true
  const me = ip && parseIp(ip)
  if (!me) return false
  return list.some((r) => {
    const p = parseRange(r)
    return p && p.ip.bits === me.bits && me.n >> BigInt(me.bits - p.bits) === p.ip.n >> BigInt(me.bits - p.bits)
  })
}
