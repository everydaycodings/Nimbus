// Run: node --test lib/secrets/egress.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { checkAddress, resetOwn } from "./egress.ts"
import { isPrivateAddress } from "./tls-watch.ts"

test("Nimbus's own Postgres and Redis are refused however they're spelled; other ports aren't", async () => {
  process.env.DATABASE_URL = "postgres://u:p@127.0.0.1:5999/db"
  process.env.REDIS_URL = "redis://localhost:6999/0"
  delete process.env.CACHE_URL
  resetOwn()
  for (const [h, p] of [["127.0.0.1", 5999], ["localhost", 5999], ["0.0.0.0", 5999], ["127.0.0.2", 5999], ["::1", 6999], ["[::1]", 6999], ["127.0.0.1", 6999]] as const)
    await assert.rejects(checkAddress(h, p, true), /own database or Redis/, `${h}:${p}`)
  assert.equal(await checkAddress("127.0.0.1", 5998, true), "127.0.0.1")
  assert.equal(await checkAddress("8.8.8.8", 5999, true), "8.8.8.8")
})

test("private addresses are refused when not allowed, including IPv6 forms that carry IPv4", async () => {
  resetOwn()
  for (const h of ["10.0.0.1", "169.254.169.254", "localhost", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe", "2002:7f00:1::", "fe80::1"])
    await assert.rejects(checkAddress(h, 80, false), /private/, h)
  assert.equal(await checkAddress("1.1.1.1", 80, false), "1.1.1.1")
  await assert.rejects(checkAddress("nonexistent.invalid", 80, true), /doesn't resolve/)
})

test("domain watch's private check covers the IPv6-mapped forms too", () => {
  for (const ip of ["::ffff:7f00:1", "64:ff9b::a00:1", "2002:a9fe:a9fe::1"]) assert.ok(isPrivateAddress(ip), ip)
})
