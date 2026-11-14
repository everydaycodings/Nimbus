// ssh2 can't log in with an OpenSSH certificate. A certificate login differs from a
// plain key login in two ways: the key algorithm name is the "-cert-v01@openssh.com" one
// and the public key is the certificate blob, while the signature still names the plain
// algorithm ("ssh-ed25519"). makeCertKey wraps a parsed private key, and authPK is
// patched (once) to send that variant. connectHop opens one SSH hop with a pinned host key
// (the terminal sidecar and server push both use it). Relative-import only: the sidecar loads it.
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import type { Duplex } from "node:stream"

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

// One SSH hop. `dial`: the checked address to connect to (lib/secrets/egress.ts), else `host`.
export type Hop = {
  host: string
  dial?: string
  port: number
  username: string
  hostId: string
  hostKey: string | null
  privateKey: string
  passphrase?: string
  certificate?: string
}
export type Seen = { key?: string; mismatch?: boolean }

// Connects one hop (over `sock`, a channel through a jump host, when given). A pinned host
// key must match; the key seen is left in `seen` so a first one can be pinned.
export function connectHop(h: Hop, sock: Duplex | undefined, seen: Seen) {
  return new Promise<ssh2.Client>((resolve, reject) => {
    const c = new ssh2.Client()
    c.on("ready", () => resolve(c)).on("error", reject)
    c.connect({
      host: h.dial ?? h.host,
      port: h.port,
      username: h.username,
      sock,
      readyTimeout: 15_000,
      keepaliveInterval: 20_000,
      ...(h.certificate
        ? { authHandler: [{ type: "publickey" as const, username: h.username, key: makeCertKey(h.privateKey, h.passphrase, h.certificate) }] as unknown as ssh2.AuthenticationType[] }
        : { privateKey: h.privateKey, passphrase: h.passphrase }),
      hostVerifier: (key: Buffer) => {
        seen.key = createHash("sha256").update(key).digest("base64")
        if (h.hostKey && h.hostKey !== seen.key) return (seen.mismatch = true), false
        return true
      },
    })
  })
}

// A channel from `via` to host:port, to run the next hop over.
export const forward = (via: ssh2.Client, host: string, port: number) =>
  new Promise<Duplex>((res, rej) => via.forwardOut("127.0.0.1", 0, host, port, (e, s) => (e ? rej(e) : res(s))))
