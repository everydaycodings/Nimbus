// Run: node --test lib/secrets/tls-watch.test.ts
import assert from "node:assert/strict"
import tls from "node:tls"
import { test } from "node:test"

import { createCa, issueLeaf } from "./pki-core.ts"
import { liveCert } from "./tls-watch.ts"

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
