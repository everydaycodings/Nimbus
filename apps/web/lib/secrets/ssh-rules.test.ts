import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { fingerprint, generateCa, generateKey, inspectPrivate, parsePublic, signUserCert, sshConfig, SshError } from "./ssh-rules.ts"

test("generate, then parse back with the same fingerprint", () => {
  for (const kind of ["ed25519"] as const) {
    const k = generateKey(kind, "me@x")
    const i = inspectPrivate(k.privateKey)
    assert.equal(i.fingerprint, k.fingerprint)
    assert.equal(parsePublic(k.publicKey).fingerprint, k.fingerprint)
    assert.equal(i.comment, "me@x")
    assert.match(k.fingerprint, /^SHA256:/)
  }
})

test("passphrase keys need the passphrase", () => {
  const k = generateKey("ed25519", "p", "hunter2")
  assert.throws(() => inspectPrivate(k.privateKey), SshError)
  assert.throws(() => inspectPrivate(k.privateKey, "nope"), SshError)
  assert.equal(inspectPrivate(k.privateKey, "hunter2").fingerprint, k.fingerprint)
})

test("rejects junk and public keys", () => {
  assert.throws(() => inspectPrivate("hello"), SshError)
  assert.throws(() => parsePublic("hello"), SshError)
  assert.throws(() => inspectPrivate(generateKey("ed25519", "").publicKey), SshError)
})

test("signed certificate is read by ssh-keygen", (t) => {
  try {
    execFileSync("ssh-keygen", ["-V"], { stdio: "ignore" })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return t.skip("no ssh-keygen")
  }
  const ca = generateCa()
  const dir = mkdtempSync(join(tmpdir(), "cert-"))
  for (const kind of ["ed25519", "rsa"] as const) {
    const k = generateKey(kind, "u")
    const c = signUserCert({
      caPrivatePem: ca.privatePem,
      caPublicKey: ca.publicKey,
      subjectPublicKey: k.publicKey,
      keyId: "a@b.c",
      principals: ["deploy", "root"],
      serial: 7,
      hours: 2,
    })
    const f = join(dir, `${kind}-cert.pub`)
    writeFileSync(f, c.line)
    const out = execFileSync("ssh-keygen", ["-L", "-f", f]).toString()
    assert.match(out, /Type: ssh-(ed25519|rsa)-cert-v01@openssh.com user certificate/)
    assert.match(out, /Serial: 7/)
    assert.match(out, /Key ID: "a@b.c"/)
    assert.match(out, /deploy/)
    assert.ok(out.includes(`Signing CA: ED25519 ${ca.fingerprint}`))
    assert.match(out, /Valid: from .* to /)
  }
})

test("certificate limits", () => {
  const ca = generateCa()
  const k = generateKey("ed25519", "").publicKey
  const base = { caPrivatePem: ca.privatePem, caPublicKey: ca.publicKey, subjectPublicKey: k, keyId: "x", serial: 1 }
  assert.throws(() => signUserCert({ ...base, principals: ["a"], hours: 9 }), SshError)
  assert.throws(() => signUserCert({ ...base, principals: ["a"], hours: 0.5 }), SshError)
  assert.throws(() => signUserCert({ ...base, principals: [], hours: 2 }), SshError)
  assert.throws(() => signUserCert({ ...base, principals: ["a b"], hours: 2 }), SshError)
})

test("config export", () => {
  const s = sshConfig([
    { name: "Web 1", host: "10.0.0.1", port: 2222, username: "deploy", keyFile: "id_web", jump: "Bastion" },
    { name: "Bastion", host: "b.example.com", port: 22, username: "me" },
  ])
  assert.match(s, /Host Web-1\n  HostName 10.0.0.1\n  Port 2222\n  User deploy\n  IdentityFile ~\/.ssh\/id_web/)
  assert.match(s, /ProxyJump Bastion/)
  assert.ok(!/Port 22\n/.test(s.split("Host Bastion")[1]))
  assert.equal(fingerprint(Buffer.from("x")).length, 50)
})
