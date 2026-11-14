// The certificate a host:port serves right now. Doesn't judge trust: it reports what it sees.
// Relative-import safe so node --test can load it.
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import tls from "node:tls"

import { isPrivateIp } from "../push-rules.ts"
import { certInfo } from "./pki-core.ts"

// Loopback, private, link-local (cloud metadata), CGNAT, unspecified and multicast addresses,
// including IPv6 forms that carry one of those (::ffff:7f00:1, 64:ff9b::a9fe:a9fe, 2002:…).
export const isPrivateAddress = isPrivateIp

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
