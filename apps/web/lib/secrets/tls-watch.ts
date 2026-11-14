// The certificate a host:port serves right now. Doesn't judge trust: it reports what it sees.
// Relative-import safe so node --test can load it.
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import tls from "node:tls"

import { certInfo } from "./pki-core.ts"

// Loopback, private, link-local (cloud metadata), CGNAT, unspecified and multicast addresses.
export function isPrivateAddress(ip: string): boolean {
  const v6 = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (v6) ip = v6[1]
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  return /^(::1?|f[cd]|fe[89ab]|ff)/i.test(ip)
}

// Resolves the host and refuses private answers (unless allowed). Returns the address to dial,
// so the check and the connection use the same one (no DNS rebinding between them).
export async function publicAddress(host: string, allowPrivate: boolean): Promise<string> {
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address)
  if (!ips.length) throw new Error("That host name doesn't resolve.")
  if (!allowPrivate && ips.some(isPrivateAddress)) throw new Error("That address is private. An admin can allow private addresses in Admin → Sharing → Secrets.")
  return ips[0]
}

// `ip`: dial this address, keeping `host` for the certificate name.
export function liveCert(host: string, port: number, timeoutMs = 8000, ip?: string) {
  return new Promise<ReturnType<typeof certInfo>>((resolve, reject) => {
    const s = tls.connect({ host: ip ?? host, port, servername: isIP(host) ? undefined : host, rejectUnauthorized: false, timeout: timeoutMs })
    const done = (e: Error | null, v?: ReturnType<typeof certInfo>) => {
      s.destroy()
      if (e) reject(e)
      else resolve(v!)
    }
    s.once("secureConnect", () => {
      try {
        const raw = s.getPeerCertificate().raw
        if (!raw) return done(new Error("The server sent no certificate."))
        done(null, certInfo(raw))
      } catch (e) {
        done(e as Error)
      }
    })
    s.once("timeout", () => done(new Error("Timed out connecting.")))
    s.once("error", (e) => done(new Error(/ECONNREFUSED/.test(e.message) ? "Connection refused." : /ENOTFOUND/.test(e.message) ? "That host name doesn't resolve." : e.message)))
  })
}
