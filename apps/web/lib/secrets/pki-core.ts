// Certificates without a database: parse PEM/DER/PFX, read a certificate, build
// a private CA, sign leaf certificates, write CRLs, export PFX. node:crypto's
// X509Certificate reads; @peculiar/x509 builds and signs (CSR, CRL, extensions);
// node-forge only opens and writes PKCS#12 (node has no API for it).
// Relative-import safe so node --test can load it.
import { isIP } from "node:net"
import { createPrivateKey, randomBytes, webcrypto, X509Certificate } from "node:crypto"

import * as x509 from "@peculiar/x509"
import forge from "node-forge"

x509.cryptoProvider.set(webcrypto as Crypto)

export class PkiError extends Error {}
const bad = (m: string) => new PkiError(m)

export type KeyKind = "ec" | "rsa"

const pemOf = (label: string, der: Uint8Array | Buffer) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n").trim()}\n-----END ${label}-----\n`
const derOfPem = (pem: string) => Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64")

// ---- Reading --------------------------------------------------------------

export type CertInfo = {
  subject: string
  cn: string
  issuer: string
  serial: string
  notBefore: Date
  notAfter: Date
  sans: string[]
  keyType: string
  fingerprint: string
  isCa: boolean
  selfSigned: boolean
}

// Node gives undefined for an empty name, which is what Let's Encrypt certificates have as subject.
const dn = (s?: string) => (s ?? "").split("\n").join(", ")

export function certInfo(pem: string | Buffer): CertInfo {
  let c: X509Certificate
  try {
    c = new X509Certificate(pem)
  } catch {
    throw bad("That isn't a readable certificate.")
  }
  const k = c.publicKey
  const d = k.asymmetricKeyDetails
  const keyType =
    k.asymmetricKeyType === "rsa"
      ? `RSA ${d?.modulusLength}`
      : k.asymmetricKeyType === "ec"
        ? `EC ${d?.namedCurve}`
        : String(k.asymmetricKeyType)
  const subject = dn(c.subject)
  const sans = (c.subjectAltName ?? "")
    .split(/,\s*/)
    .filter(Boolean)
    .map((s) => s.replace(/^IP Address:/, "IP:"))
  return {
    subject,
    cn: /(?:^|\n)CN=([^\n]*)/.exec(c.subject ?? "")?.[1] ?? sans[0]?.replace(/^DNS:/, "") ?? subject,
    issuer: dn(c.issuer),
    serial: c.serialNumber.toLowerCase(),
    notBefore: new Date(c.validFrom),
    notAfter: new Date(c.validTo),
    sans,
    keyType,
    fingerprint: c.fingerprint256,
    isCa: c.ca,
    selfSigned: dn(c.subject) === dn(c.issuer) && c.verify(c.publicKey),
  }
}

export const pemOfCert = (c: Buffer | string) => new X509Certificate(c).toString().trim() + "\n"

export function keyMatches(certPem: string, keyPem: string) {
  try {
    return new X509Certificate(certPem).checkPrivateKey(createPrivateKey(keyPem))
  } catch {
    return false
  }
}

// Any private key in any common form, as PKCS#8 PEM.
function pkcs8(key: Buffer | string, passphrase?: string) {
  const o = typeof key === "string" ? { key, passphrase } : { key, format: "der" as const, type: "pkcs8" as const, passphrase }
  const attempts = typeof key === "string" ? [o] : [o, { ...o, type: "pkcs1" as const }, { ...o, type: "sec1" as const }]
  let last: unknown
  for (const a of attempts) {
    try {
      return createPrivateKey(a as never).export({ format: "pem", type: "pkcs8" }).toString()
    } catch (e) {
      last = e
    }
  }
  throw bad(/passphrase|decrypt/i.test(String((last as Error)?.message)) ? "The private key needs its password, or the password is wrong." : "That private key isn't readable.")
}

// What a set of uploaded files holds: certificates as PEM and at most one private key.
export function readFiles(files: Buffer[], password = "") {
  const certs: string[] = []
  let key: string | null = null
  const addKey = (k: string) => {
    if (key && key !== k) throw bad("Those files hold more than one private key.")
    key = k
  }
  const addCert = (c: Buffer | string) => {
    const pem = pemOfCert(c)
    if (!certs.includes(pem)) certs.push(pem)
  }
  for (const f of files) {
    const text = f.toString("latin1")
    if (text.includes("-----BEGIN")) {
      for (const m of text.matchAll(/-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g)) {
        if (m[1] === "CERTIFICATE" || m[1] === "TRUSTED CERTIFICATE") addCert(m[0])
        else if (m[1].includes("PRIVATE KEY")) addKey(pkcs8(m[0], password || undefined))
      }
      continue
    }
    const p12 = openPfx(f, password)
    if (p12) {
      p12.certs.forEach((c) => addCert(c))
      if (p12.key) addKey(p12.key)
      continue
    }
    try {
      addCert(f)
      continue
    } catch {}
    addKey(pkcs8(f, password || undefined))
  }
  if (!certs.length) throw bad("No certificate found in those files.")
  return { certs, key: key as string | null }
}

function openPfx(buf: Buffer, password: string) {
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(buf.toString("binary"))), password)
  } catch (e) {
    const m = String((e as Error).message)
    if (/mac|password|Invalid/i.test(m) && /PKCS#12|MAC|password/i.test(m)) throw bad("The PFX password is wrong.")
    return null
  }
  const certs: string[] = []
  let key: string | null = null
  for (const sc of p12.safeContents)
    for (const bag of sc.safeBags) {
      if (bag.type === forge.pki.oids.certBag) {
        // forge only models RSA certificates; for the rest it keeps the raw ASN.1.
        certs.push(bag.cert ? forge.pki.certificateToPem(bag.cert) : pemOf("CERTIFICATE", Buffer.from(forge.asn1.toDer(bag.asn1).getBytes(), "binary")))
      } else if (bag.key) key = pkcs8(forge.pki.privateKeyToPem(bag.key))
      else if (bag.type === forge.pki.oids.pkcs8ShroudedKeyBag || bag.type === forge.pki.oids.keyBag) {
        // forge can't model EC keys, but it hands over the decrypted PKCS#8.
        key = pkcs8(Buffer.from(forge.asn1.toDer(bag.asn1).getBytes(), "binary"))
      }
    }
  return { certs, key }
}

// The leaf (the one that issued no other), the key if it fits, and the rest as a chain from leaf up.
export function arrange(certs: string[], key: string | null) {
  const infos = certs.map((pem) => ({ pem, i: certInfo(pem), x: new X509Certificate(pem) }))
  const leaves = infos.filter((a) => !infos.some((b) => b !== a && b.x.checkIssued(a.x)))
  const leaf = (key && leaves.find((l) => keyMatches(l.pem, key))) || leaves[0] || infos[0]
  const chain: typeof infos = []
  let cur = leaf
  for (;;) {
    const up = infos.find((o) => o !== cur && !chain.includes(o) && o !== leaf && cur.x.checkIssued(o.x))
    if (!up) break
    chain.push(up)
    cur = up
  }
  return { leaf: leaf.pem, chain: chain.map((c) => c.pem), keyMatches: key ? keyMatches(leaf.pem, key) : null }
}

// ---- PFX out --------------------------------------------------------------

export function toPfx(certPem: string, chainPem: string[], keyPem: string, password: string) {
  const pk8 = forge.asn1.fromDer(forge.util.createBuffer(derOfPem(keyPem).toString("binary")))
  const certs = [certPem, ...chainPem].map((p) => ({ asn1: forge.asn1.fromDer(forge.util.createBuffer(derOfPem(p).toString("binary"))) }))
  const pki = forge.pki as unknown as Record<string, unknown>
  const orig = [pki.privateKeyToAsn1, pki.wrapRsaPrivateKey, pki.certificateToAsn1]
  // forge only writes RSA keys and certificates; swap in our PKCS#8 and DER (they work for EC) for this one synchronous call.
  pki.privateKeyToAsn1 = () => null
  pki.wrapRsaPrivateKey = () => pk8
  pki.certificateToAsn1 = (c: { asn1: forge.asn1.Asn1 }) => c.asn1
  try {
    const asn1 = forge.pkcs12.toPkcs12Asn1({} as never, certs as never, password, { algorithm: "aes256", count: 10000 })
    return Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary")
  } finally {
    ;[pki.privateKeyToAsn1, pki.wrapRsaPrivateKey, pki.certificateToAsn1] = orig
  }
}

// ---- Names ---------------------------------------------------------------

// "*.example.com" matches any name under example.com (not example.com itself); "*" matches all.
export function nameAllowed(patterns: string[], name: string) {
  const n = name.toLowerCase()
  return patterns.some((p) => {
    const q = p.toLowerCase().trim()
    return q === "*" || q === n || (q.startsWith("*.") && n.endsWith(q.slice(1)) && n.length > q.length - 1)
  })
}

type Gn = { type: "dns" | "ip" | "email"; value: string }
export function parseNames(names: string[]): Gn[] {
  return names.map((s) => s.trim()).filter(Boolean).map((v) => ({ type: isIP(v) ? "ip" : v.includes("@") ? "email" : "dns", value: v }))
}
const nameOf = (g: Gn) => g.value

// ---- Keys, CAs, leaf certificates ------------------------------------------

const ALG = {
  ec: { gen: { name: "ECDSA", namedCurve: "P-256" } as EcKeyGenParams, sign: { name: "ECDSA", hash: "SHA-256" } },
  rsa: { gen: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) } as RsaHashedKeyGenParams, sign: { name: "RSASSA-PKCS1-v1_5" } },
}

export async function genKey(kind: KeyKind) {
  const pair = (await webcrypto.subtle.generateKey(ALG[kind].gen, true, ["sign", "verify"])) as CryptoKeyPair
  const der = await webcrypto.subtle.exportKey("pkcs8", pair.privateKey)
  return { pair, keyPem: pemOf("PRIVATE KEY", new Uint8Array(der)) }
}

async function signer(keyPem: string) {
  const type = createPrivateKey(keyPem).asymmetricKeyType === "rsa" ? "rsa" : "ec"
  const gen = ALG[type].gen as { name: string; namedCurve?: string; hash?: string }
  const alg = type === "rsa" ? { name: gen.name, hash: "SHA-256" } : { name: gen.name, namedCurve: gen.namedCurve }
  const key = await webcrypto.subtle.importKey("pkcs8", derOfPem(keyPem), alg, true, ["sign"])
  return { key, alg: ALG[type].sign }
}

const serial = () => {
  const b = randomBytes(16)
  b[0] = (b[0] & 0x7f) | 0x10 // positive, never starts with a zero byte
  return b.toString("hex")
}

type Authority = { certPem: string; keyPem: string }

const names = (n: string) => n.replace(/[,+=\\]/g, " ").trim()

export async function createCa(o: { cn: string; years: number; keyKind: KeyKind; parent?: Authority; crlUrl?: string }) {
  const { pair, keyPem } = await genKey(o.keyKind)
  const now = new Date()
  const notAfter = new Date(now.getTime() + o.years * 365 * 86_400_000)
  const subject = `CN=${names(o.cn)}`
  const parentCert = o.parent ? new x509.X509Certificate(o.parent.certPem) : null
  if (parentCert && parentCert.notAfter < notAfter) throw bad("An intermediate can't outlive its parent. Pick fewer years.")
  const s = await signer(o.parent?.keyPem ?? keyPem)
  const exts: x509.Extension[] = [
    new x509.BasicConstraintsExtension(true, o.parent ? 0 : 1, true),
    new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
    await x509.SubjectKeyIdentifierExtension.create(pair.publicKey),
  ]
  if (parentCert) exts.push(await x509.AuthorityKeyIdentifierExtension.create(parentCert, false))
  if (o.parent && o.crlUrl) exts.push(new x509.CRLDistributionPointsExtension([o.crlUrl]))
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject,
    issuer: parentCert ? parentCert.subject : subject,
    notBefore: new Date(now.getTime() - 5 * 60_000),
    notAfter,
    signingAlgorithm: s.alg,
    publicKey: pair.publicKey,
    signingKey: s.key,
    extensions: exts,
  })
  return { certPem: pemOfCert(cert.toString("pem")), keyPem }
}

export type LeafKind = "server" | "client"

export async function issueLeaf(o: {
  ca: Authority
  kind: LeafKind
  cn: string
  sans: string[]
  ttlDays: number
  csrPem?: string
  keyKind?: KeyKind
  crlUrl?: string
}) {
  const caCert = new x509.X509Certificate(o.ca.certPem)
  let publicKey: x509.PublicKey | CryptoKey
  let keyPem: string | null = null
  if (o.csrPem) {
    const csr = new x509.Pkcs10CertificateRequest(o.csrPem)
    if (!(await csr.verify())) throw bad("The CSR's signature doesn't check out.")
    publicKey = csr.publicKey
  } else {
    const k = await genKey(o.keyKind ?? "ec")
    publicKey = k.pair.publicKey
    keyPem = k.keyPem
  }
  const now = new Date()
  const notAfter = new Date(now.getTime() + o.ttlDays * 86_400_000)
  if (notAfter > caCert.notAfter) throw bad("That would outlive the CA. Pick a shorter lifetime or renew the CA.")
  const gns = parseNames(o.sans)
  const s = await signer(o.ca.keyPem)
  const exts: x509.Extension[] = [
    new x509.BasicConstraintsExtension(false, undefined, true),
    new x509.KeyUsagesExtension(
      o.kind === "server" ? x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment : x509.KeyUsageFlags.digitalSignature,
      true
    ),
    new x509.ExtendedKeyUsageExtension([o.kind === "server" ? x509.ExtendedKeyUsage.serverAuth : x509.ExtendedKeyUsage.clientAuth]),
    await x509.SubjectKeyIdentifierExtension.create(publicKey as never),
    await x509.AuthorityKeyIdentifierExtension.create(caCert, false),
  ]
  if (gns.length) exts.push(new x509.SubjectAlternativeNameExtension(gns.map((g) => ({ type: g.type, value: nameOf(g) })) as never))
  if (o.crlUrl) exts.push(new x509.CRLDistributionPointsExtension([o.crlUrl]))
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: `CN=${names(o.cn)}`,
    issuer: caCert.subject,
    notBefore: new Date(now.getTime() - 5 * 60_000),
    notAfter,
    signingAlgorithm: s.alg,
    publicKey: publicKey as never,
    signingKey: s.key,
    extensions: exts,
  })
  return { certPem: pemOfCert(cert.toString("pem")), keyPem }
}

// Names a CSR asks for, to check against a template when none were typed in.
export function csrNames(csrPem: string) {
  const csr = new x509.Pkcs10CertificateRequest(csrPem)
  const san = csr.extensions.find((e) => e.type === "2.5.29.17")
  return {
    cn: /CN=([^,]+)/.exec(csr.subject)?.[1] ?? "",
    sans: san ? new x509.SubjectAlternativeNameExtension(san.rawData).names.items.map((n) => n.value) : [],
  }
}

export async function buildCrl(o: { ca: Authority; revoked: { serial: string; at: Date; reason?: number }[]; days?: number }) {
  const caCert = new x509.X509Certificate(o.ca.certPem)
  const s = await signer(o.ca.keyPem)
  const now = new Date()
  const crl = await x509.X509CrlGenerator.create({
    issuer: caCert.subject,
    thisUpdate: now,
    nextUpdate: new Date(now.getTime() + (o.days ?? 7) * 86_400_000),
    entries: o.revoked.map((r) => ({ serialNumber: r.serial, revocationDate: r.at, reason: r.reason })),
    extensions: [await x509.AuthorityKeyIdentifierExtension.create(caCert, false)],
    signingAlgorithm: s.alg,
    signingKey: s.key,
  })
  return pemOf("X509 CRL", new Uint8Array(crl.rawData))
}
