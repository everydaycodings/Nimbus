// ssh2 can't log in with an OpenSSH certificate. A certificate login differs from a
// plain key login in two ways: the key algorithm name is the "-cert-v01@openssh.com" one
// and the public key is the certificate blob, while the signature still names the plain
// algorithm ("ssh-ed25519"). makeCertKey wraps a parsed private key, and authPK is
// patched (once) to send that variant. Relative-import only: the terminal sidecar loads it.
import { createRequire } from "node:module"

import ssh2 from "ssh2"

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Protocol = require("ssh2/lib/protocol/Protocol.js") as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { sendPacket } = require("ssh2/lib/protocol/utils.js") as any

const s = (v: Buffer | string) => {
  const d = typeof v === "string" ? Buffer.from(v) : v
  const l = Buffer.alloc(4)
  l.writeUInt32BE(d.length)
  return Buffer.concat([l, d])
}

type CertMark = { algo: string; sigName: string }

if (!Protocol.prototype.__nimbusCert) {
  const orig = Protocol.prototype.authPK
  Protocol.prototype.__nimbusCert = true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Protocol.prototype.authPK = function (this: any, username: string, key: any, keyAlgo: unknown, cbSign?: unknown) {
    const mark = key?.nimbusCert as CertMark | undefined
    if (!mark) return orig.call(this, username, key, keyAlgo, cbSign)
    const sign = (typeof keyAlgo === "function" ? keyAlgo : cbSign) as ((d: Buffer, cb: (sig: Buffer) => void) => void) | undefined
    const head = (signed: boolean) =>
      Buffer.concat([
        Buffer.from([50]),
        s(username),
        s("ssh-connection"),
        s("publickey"),
        Buffer.from([signed ? 1 : 0]),
        s(mark.algo),
        s(key.getPublicSSH()),
      ])
    const send = (body: Buffer) => {
      const p = this._packetRW.write.alloc(body.length)
      body.copy(p, this._packetRW.write.allocStart)
      sendPacket(this, this._packetRW.write.finalize(p))
    }
    if (!sign) {
      this._authsQueue.push("publickey")
      return send(head(false))
    }
    const h = head(true)
    sign(Buffer.concat([s(this._kex.sessionID), h]), (sig) => {
      this._authsQueue.push("publickey")
      send(Buffer.concat([h, s(Buffer.concat([s(mark.sigName), s(sig)]))]))
    })
  }
}

// A private key that authenticates with `certLine` ("ssh-ed25519-cert-v01@openssh.com AAAA… id").
export function makeCertKey(privateKey: string, passphrase: string | undefined, certLine: string) {
  const k = ssh2.utils.parseKey(privateKey, passphrase)
  if (k instanceof Error || Array.isArray(k)) throw new Error("Unreadable key for the certificate.")
  const [algo, b64] = certLine.trim().split(/\s+/)
  if (algo !== "ssh-ed25519-cert-v01@openssh.com") throw new Error("Only ed25519 certificates are supported here.")
  const blob = Buffer.from(b64, "base64")
  const mark: CertMark = { algo, sigName: "ssh-ed25519" }
  return Object.assign(Object.create(k), { getPublicSSH: () => blob, nimbusCert: mark }) as ssh2.ParsedKey
}
