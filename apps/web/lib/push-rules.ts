// Pure rules for push endpoints, kept apart so tests can run them.
import { BlockList, isIP } from "node:net"

const blocked = new BlockList()
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(net, bits, "ipv4")
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001::", 32], // Teredo
  ["64:ff9b:1::", 48], // local-use NAT64
] as const)
  blocked.addSubnet(net, bits, "ipv6")

// The eight 16-bit groups of an IPv6 address, "::" expanded.
function groups(ip: string) {
  const [head, tail] = ip.split("::")
  const h = head ? head.split(":") : []
  const t = tail ? tail.split(":") : []
  const mid = Array(8 - h.length - t.length).fill("0")
  return [...h, ...mid, ...t].map((g) => parseInt(g, 16))
}

// The IPv4 address an IPv6 one carries (mapped, compatible, NAT64, 6to4), or null.
function embeddedV4(g: number[]) {
  const v4 = (hi: number, lo: number) =>
    `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0)
  if (zeros(0, 5) && (g[5] === 0xffff || g[5] === 0)) return v4(g[6], g[7])
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return v4(g[6], g[7])
  if (g[0] === 0x2002) return v4(g[1], g[2])
  return null
}

// Anything that isn't a public address. IPv6 forms that carry an IPv4 address
// (::ffff:7f00:1, 64:ff9b::a00:1, 2002:7f00:1::) are judged by that address.
// Anything that doesn't parse counts as private.
export function isPrivateIp(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase()
  const kind = isIP(addr)
  if (kind === 4) return blocked.check(addr, "ipv4")
  if (kind !== 6) return true
  // "::ffff:1.2.3.4" has its tail in dotted form; make it hex groups.
  const dotted = addr.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  const hex = dotted
    ? dotted[1] +
      ((+dotted[2] << 8) | +dotted[3]).toString(16) +
      ":" +
      ((+dotted[4] << 8) | +dotted[5]).toString(16)
    : addr
  const inner = embeddedV4(groups(hex))
  return blocked.check(hex, "ipv6") || (inner !== null && isPrivateIp(inner))
}

// A `lookup` for http(s).request that always answers `ip`, so the connection
// goes to the address that was checked, whatever DNS says later. Host header
// and TLS server name still come from the URL.
export function pinnedLookup(ip: string) {
  const family = ip.includes(":") ? 6 : 4
  return (
    _host: string,
    opts: { all?: boolean },
    cb: (err: null, addr: unknown, family?: number) => void
  ) => (opts.all ? cb(null, [{ address: ip, family }]) : cb(null, ip, family))
}
