// The certificate a host:port serves right now. Doesn't judge trust: it reports what it sees.
// Relative-import safe so node --test can load it.
import { isIP } from "node:net"
import tls from "node:tls"

import { certInfo } from "./pki-core.ts"

export function liveCert(host: string, port: number, timeoutMs = 8000) {
  return new Promise<ReturnType<typeof certInfo>>((resolve, reject) => {
    const s = tls.connect({ host, port, servername: isIP(host) ? undefined : host, rejectUnauthorized: false, timeout: timeoutMs })
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
