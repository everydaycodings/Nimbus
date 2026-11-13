// SSH helpers with no database or Next imports (node --test and the terminal
// sidecar load this): key parsing and fingerprints, generation, OpenSSH user
// certificates signed with an ed25519 CA, ~/.ssh/config and sshd setup text.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto"

import ssh2 from "ssh2"

const { utils } = ssh2

export class SshError extends Error {}

export const fingerprint = (blob: Buffer) => "SHA256:" + createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")

export type KeyInfo = { kind: "ed25519" | "rsa" | "ecdsa"; publicKey: string; fingerprint: string; comment: string }

const KIND: Record<string, KeyInfo["kind"]> = { "ssh-ed25519": "ed25519", "ssh-rsa": "rsa" }

// One public key line: "ssh-ed25519 AAAA… comment".
export function parsePublic(line: string): KeyInfo & { blob: Buffer; type: string } {
  const m = line.trim().match(/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+)\s+([A-Za-z0-9+/=]+)(?:\s+(.*))?$/)
  if (!m) throw new SshError("That isn't a public key line (ssh-ed25519 AAAA… or ssh-rsa AAAA…).")
  const blob = Buffer.from(m[2], "base64")
  const comment = (m[3] ?? "").trim()
  return {
    type: m[1],
    blob,
    kind: KIND[m[1]] ?? "ecdsa",
    publicKey: `${m[1]} ${m[2]}${comment ? " " + comment : ""}`,
    fingerprint: fingerprint(blob),
    comment,
  }
}

// Reads a private key (OpenSSH or PEM), asking for the passphrase when it has one.
export function inspectPrivate(text: string, passphrase?: string): KeyInfo {
  const k = utils.parseKey(text.trim(), passphrase || undefined)
  if (k instanceof Error) {
    if (/passphrase|encrypted|bad/i.test(k.message))
      throw new SshError(passphrase ? "That passphrase doesn't open the key." : "This key has a passphrase. Enter it too.")
    throw new SshError("That isn't a private key we can read.")
  }
  if (Array.isArray(k)) throw new SshError("Paste one key at a time.")
  if (!k.isPrivateKey()) throw new SshError("That's a public key. Paste the private key.")
  const blob = k.getPublicSSH()
  const comment = (k.comment || "").trim()
  const b64 = blob.toString("base64")
  return {
    kind: KIND[k.type] ?? "ecdsa",
    publicKey: `${k.type} ${b64}${comment ? " " + comment : ""}`,
    fingerprint: fingerprint(blob),
    comment,
  }
}

export function generateKey(kind: "ed25519" | "rsa", comment: string, passphrase?: string) {
  const pair = utils.generateKeyPairSync(kind, {
    ...(kind === "rsa" && { bits: 4096 }),
    comment,
    ...(passphrase && { passphrase, cipher: "aes256-ctr", rounds: 16 }),
  })
  return { privateKey: pair.private.trim() + "\n", ...inspectPrivate(pair.private, passphrase) }
}

// ---------- certificates (PROTOCOL.certkeys) ----------

const str = (b: Buffer | string) => {
  const d = typeof b === "string" ? Buffer.from(b) : b
  const l = Buffer.alloc(4)
  l.writeUInt32BE(d.length)
  return Buffer.concat([l, d])
}
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
const u64 = (n: number) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt(n))
  return b
}

function readParts(blob: Buffer) {
  const out: Buffer[] = []
  for (let p = 0; p < blob.length; ) {
    const n = blob.readUInt32BE(p)
    out.push(blob.subarray(p + 4, p + 4 + n))
    p += 4 + n
  }
  return out
}

export const CERT_MIN_HOURS = 1
export const CERT_MAX_HOURS = 8
export const PRINCIPAL_RE = /^[A-Za-z0-9._@-]{1,64}$/

export function generateCa(comment = "nimbus-ssh-ca") {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url")
  const blob = Buffer.concat([str("ssh-ed25519"), str(raw)])
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: `ssh-ed25519 ${blob.toString("base64")} ${comment}`,
    fingerprint: fingerprint(blob),
  }
}

export type CertInput = {
  caPrivatePem: string
  caPublicKey: string
  subjectPublicKey: string
  keyId: string
  principals: string[]
  serial: number
  hours: number
  now?: Date
}

// A user certificate for an ed25519 or RSA public key. Returns the one-line form
// (what ssh reads from *-cert.pub) and its blob.
export function signUserCert(i: CertInput) {
  if (!(i.hours >= CERT_MIN_HOURS && i.hours <= CERT_MAX_HOURS))
    throw new SshError(`A certificate lasts ${CERT_MIN_HOURS} to ${CERT_MAX_HOURS} hours.`)
  if (!i.principals.length || i.principals.length > 10 || i.principals.some((p) => !PRINCIPAL_RE.test(p)))
    throw new SshError("Give 1 to 10 principals (user names), letters, digits and . _ @ -")
  const sub = parsePublic(i.subjectPublicKey)
  const parts = readParts(sub.blob)
  let certType: string
  let keyFields: Buffer
  if (sub.type === "ssh-ed25519") {
    certType = "ssh-ed25519-cert-v01@openssh.com"
    keyFields = str(parts[1])
  } else if (sub.type === "ssh-rsa") {
    certType = "ssh-rsa-cert-v01@openssh.com"
    keyFields = Buffer.concat([str(parts[1]), str(parts[2])])
  } else throw new SshError("Certificates support ed25519 and RSA keys.")
  const now = i.now ?? new Date()
  const after = Math.floor(now.getTime() / 1000) - 60 // a minute of clock skew
  const before = Math.floor(now.getTime() / 1000) + Math.round(i.hours * 3600)
  const exts = ["permit-X11-forwarding", "permit-agent-forwarding", "permit-port-forwarding", "permit-pty", "permit-user-rc"]
  const caBlob = parsePublic(i.caPublicKey).blob
  const body = Buffer.concat([
    str(certType),
    str(randomBytes(32)),
    keyFields,
    u64(i.serial),
    u32(1),
    str(i.keyId),
    str(Buffer.concat(i.principals.map((p) => str(p)))),
    u64(after),
    u64(before),
    str(Buffer.alloc(0)),
    str(Buffer.concat(exts.map((e) => Buffer.concat([str(e), str(Buffer.alloc(0))])))),
    str(Buffer.alloc(0)),
    str(caBlob),
  ])
  const sig = sign(null, body, createPrivateKey(i.caPrivatePem))
  const blob = Buffer.concat([body, str(Buffer.concat([str("ssh-ed25519"), str(sig)]))])
  return {
    line: `${certType} ${blob.toString("base64")} ${i.keyId}`,
    blob,
    certType,
    expiresAt: new Date(before * 1000),
  }
}

// ed25519 public line for a private PEM, to check a CA key still matches.
export const publicOfPem = (pem: string) => createPublicKey(createPrivateKey(pem)).export({ format: "jwk" }).x as string

// ---------- text for the admin ----------

export type HostRow = {
  name: string
  host: string
  port: number
  username: string
  keyFile?: string | null // file name under ~/.ssh
  cert?: boolean
  jump?: string | null // another host's alias
}

export const alias = (n: string) => n.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "host"

export function sshConfig(hosts: HostRow[]) {
  return (
    hosts
      .map((h) =>
        [
          `Host ${alias(h.name)}`,
          `  HostName ${h.host}`,
          h.port !== 22 && `  Port ${h.port}`,
          `  User ${h.username}`,
          h.keyFile && `  IdentityFile ~/.ssh/${h.keyFile}`,
          h.cert && `  CertificateFile ~/.ssh/${h.keyFile ?? "nimbus-cert"}-cert.pub`,
          h.keyFile && `  IdentitiesOnly yes`,
          h.jump && `  ProxyJump ${alias(h.jump)}`,
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n") + "\n"
  )
}

export function sshdScript(caPublicKey: string) {
  return `#!/bin/sh
# Trust Nimbus's SSH CA on this server. Run as root.
set -e
echo '${caPublicKey}' > /etc/ssh/nimbus_ca.pub
chmod 644 /etc/ssh/nimbus_ca.pub
# Accept certificates signed by the CA...
grep -q '^TrustedUserCAKeys /etc/ssh/nimbus_ca.pub' /etc/ssh/sshd_config || echo 'TrustedUserCAKeys /etc/ssh/nimbus_ca.pub' >> /etc/ssh/sshd_config
# ...but only for the principals you list per account. Without this, a certificate
# is accepted for the user named in its principals. For stricter control add:
#   AuthorizedPrincipalsFile /etc/ssh/principals/%u
# and put one allowed principal per line in /etc/ssh/principals/<user>.
systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || service ssh reload
`
}
