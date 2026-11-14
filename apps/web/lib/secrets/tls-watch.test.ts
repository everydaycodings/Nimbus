// Run: node --test lib/secrets/tls-watch.test.ts
import assert from "node:assert/strict"
import tls from "node:tls"
import { test } from "node:test"

import { createCa, issueLeaf } from "./pki-core.ts"
import { isPrivateAddress, liveCert, publicAddress } from "./tls-watch.ts"

test("reads the certificate a local TLS server serves; reports a closed port", async () => {
  const ca = await createCa({ cn: "W", years: 1, keyKind: "ec" })
  const leaf = await issueLeaf({ ca, kind: "server", cn: "localhost", sans: ["localhost", "127.0.0.1"], ttlDays: 9 })
  const srv = tls.createServer({ cert: leaf.certPem, key: leaf.keyPem! }, (s) => s.end())
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r))
  const port = (srv.address() as { port: number }).port
  const info = await liveCert("localhost", port)
  assert.equal(info.cn, "localhost")
  assert.match(info.issuer, /CN=W/)
  assert.ok(info.notAfter.getTime() - Date.now() < 9.1 * 86_400_000)
  srv.close()
  await assert.rejects(liveCert("127.0.0.1", port), /refused/)
})

test("private, loopback, link-local and metadata addresses are refused unless allowed", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:169.254.169.254"])
    assert.ok(isPrivateAddress(ip), ip)
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip)
  await assert.rejects(publicAddress("169.254.169.254", false), /private/)
  await assert.rejects(publicAddress("localhost", false), /private/)
  assert.equal(await publicAddress("169.254.169.254", true), "169.254.169.254")
  assert.equal(await publicAddress("8.8.8.8", false), "8.8.8.8")
})
