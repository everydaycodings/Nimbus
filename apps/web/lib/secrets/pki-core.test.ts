// Run: node --test lib/secrets/pki-core.test.ts lib/secrets/totp.test.ts
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import * as p from "./pki-core.ts"

const openssl = spawnSync("openssl", ["version"]).status === 0
const dir = mkdtempSync(join(tmpdir(), "pki-"))
const put = (n: string, c: string | Buffer) => (writeFileSync(join(dir, n), c), join(dir, n))

for (const kind of ["ec", "rsa"] as const)
  test(`private CA (${kind}): issue, chain verifies, CRL lists the revoked serial`, async () => {
    const crlUrl = "http://nimbus.test/pki/crl/x.crl"
    const root = await p.createCa({ cn: "Test Root", years: 10, keyKind: kind })
    const inter = await p.createCa({ cn: "Test Inter", years: 5, keyKind: kind, parent: root, crlUrl })
    const a = await p.issueLeaf({ ca: inter, kind: "server", cn: "a.example.com", sans: ["a.example.com", "*.a.example.com", "10.0.0.1"], ttlDays: 30, crlUrl })
    const b = await p.issueLeaf({ ca: inter, kind: "client", cn: "bob", sans: ["bob@example.com"], ttlDays: 30, keyKind: kind })
    const info = p.certInfo(a.certPem)
    assert.equal(info.cn, "a.example.com")
    assert.deepEqual(info.sans, ["DNS:a.example.com", "DNS:*.a.example.com", "IP:10.0.0.1"])
    assert.ok(p.keyMatches(a.certPem, a.keyPem!))
    assert.ok(!p.keyMatches(a.certPem, b.keyPem!))
    assert.ok(p.certInfo(inter.certPem).isCa)
    assert.ok(p.certInfo(root.certPem).selfSigned)
    const crl = await p.buildCrl({ ca: inter, revoked: [{ serial: p.certInfo(b.certPem).serial, at: new Date(), reason: 1 }] })
    if (!openssl) return
    const R = put("root.pem", root.certPem), I = put("inter.pem", inter.certPem)
    for (const c of [a, b])
      execFileSync("openssl", ["verify", "-CAfile", R, "-untrusted", I, put("leaf.pem", c.certPem)])
    const out = execFileSync("openssl", ["crl", "-in", put("c.crl", crl), "-noout", "-text"]).toString()
    assert.ok(out.toUpperCase().includes(p.certInfo(b.certPem).serial.toUpperCase()))
    assert.ok(!out.toUpperCase().includes(p.certInfo(a.certPem).serial.toUpperCase()))
    // The CRL is signed by the intermediate.
    execFileSync("openssl", ["crl", "-in", join(dir, "c.crl"), "-noout", "-CAfile", I])
    assert.ok(execFileSync("openssl", ["x509", "-in", put("a.pem", a.certPem), "-noout", "-text"]).toString().includes(crlUrl))
  })

test("issues from a CSR and refuses a bad one", async () => {
  if (!openssl) return
  const root = await p.createCa({ cn: "R", years: 1, keyKind: "ec" })
  execFileSync("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "c.key"), "-out", join(dir, "c.csr"), "-subj", "/CN=csr.example.com", "-addext", "subjectAltName=DNS:csr.example.com"], { stdio: "pipe" })
  const csr = readFileSync(join(dir, "c.csr"), "utf8")
  assert.deepEqual(p.csrNames(csr), { cn: "csr.example.com", sans: ["csr.example.com"] })
  const l = await p.issueLeaf({ ca: root, kind: "server", cn: "csr.example.com", sans: ["csr.example.com"], ttlDays: 10, csrPem: csr })
  assert.equal(l.keyPem, null)
  assert.ok(p.keyMatches(l.certPem, readFileSync(join(dir, "c.key"), "utf8")))
  await assert.rejects(p.issueLeaf({ ca: root, kind: "server", cn: "x", sans: [], ttlDays: 3650, csrPem: csr }), /outlive/)
  await assert.rejects(p.issueLeaf({ ca: root, kind: "server", cn: "x", sans: [], ttlDays: 1, csrPem: "-----BEGIN CERTIFICATE REQUEST-----\nAAAA\n-----END CERTIFICATE REQUEST-----" }))
})

test("name patterns", () => {
  assert.ok(p.nameAllowed(["*.example.com"], "a.example.com"))
  assert.ok(p.nameAllowed(["*.example.com"], "a.b.example.com"))
  assert.ok(!p.nameAllowed(["*.example.com"], "example.com"))
  assert.ok(!p.nameAllowed(["*.example.com"], "evilexample.com"))
  assert.ok(p.nameAllowed(["example.com", "x.org"], "EXAMPLE.com"))
  assert.ok(p.nameAllowed(["*"], "anything"))
  assert.ok(!p.nameAllowed([], "a"))
})

test("reads PEM, DER, PFX (EC and RSA, with password) and arranges a chain", async () => {
  const root = await p.createCa({ cn: "R2", years: 2, keyKind: "ec" })
  const inter = await p.createCa({ cn: "I2", years: 1, keyKind: "ec", parent: root })
  for (const kind of ["ec", "rsa"] as const) {
    const l = await p.issueLeaf({ ca: inter, kind: "server", cn: "x.test", sans: ["x.test"], ttlDays: 5, keyKind: kind })
    // PEM files in a shuffled order
    const r = p.readFiles([Buffer.from(root.certPem + inter.certPem), Buffer.from(l.certPem), Buffer.from(l.keyPem!)])
    const a = p.arrange(r.certs, r.key)
    assert.equal(a.leaf, l.certPem)
    assert.deepEqual(a.chain, [inter.certPem, root.certPem])
    assert.equal(a.keyMatches, true)
    // DER cert + DER key
    const der = new (await import("node:crypto")).X509Certificate(l.certPem).raw
    const pk = (await import("node:crypto")).createPrivateKey(l.keyPem!).export({ format: "der", type: "pkcs8" })
    const r2 = p.readFiles([der, Buffer.from(pk)])
    assert.equal(r2.certs[0], l.certPem)
    assert.equal(r2.key, l.keyPem)
    // our own PFX writer, read back by us, and by openssl
    const pfx = p.toPfx(l.certPem, [inter.certPem], l.keyPem!, "pw1")
    const r3 = p.readFiles([pfx], "pw1")
    assert.equal(r3.key, l.keyPem)
    assert.equal(r3.certs.length, 2)
    assert.throws(() => p.readFiles([pfx], "nope"), /password/)
    if (openssl) {
      const out = execFileSync("openssl", ["pkcs12", "-in", put(`${kind}.pfx`, pfx), "-passin", "pass:pw1", "-nokeys", "-clcerts"], { stdio: "pipe" }).toString()
      assert.ok(out.includes("BEGIN CERTIFICATE"))
    }
  }
  if (openssl) {
    // PFX made by openssl 3 (AES) with an EC key
    execFileSync("openssl", ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", join(dir, "e.key")])
    execFileSync("openssl", ["req", "-x509", "-new", "-key", join(dir, "e.key"), "-subj", "/CN=ssl.test", "-days", "5", "-out", join(dir, "e.crt")])
    execFileSync("openssl", ["pkcs12", "-export", "-inkey", join(dir, "e.key"), "-in", join(dir, "e.crt"), "-out", join(dir, "e.pfx"), "-passout", "pass:pw"])
    const r = p.readFiles([readFileSync(join(dir, "e.pfx"))], "pw")
    assert.equal(p.certInfo(r.certs[0]).cn, "ssl.test")
    assert.ok(p.keyMatches(r.certs[0], r.key!))
  }
  assert.throws(() => p.readFiles([Buffer.from("junk")]), /./)
})

test("a certificate with an empty subject (Let's Encrypt style) reads by its SAN", async () => {
  if (!openssl) return
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", join(dir, "n.key"), "-out", join(dir, "n.crt"), "-subj", "/", "-addext", "subjectAltName=DNS:empty.example.com", "-days", "3"], { stdio: "pipe" })
  const i = p.certInfo(readFileSync(join(dir, "n.crt")))
  assert.equal(i.subject, "")
  assert.equal(i.cn, "empty.example.com")
  assert.deepEqual(i.sans, ["DNS:empty.example.com"])
})
