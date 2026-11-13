// Run: node --test lib/secrets/pwned.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { fetchRange, pwnedCount } from "./pwned.ts"
import { looksLikePassword, matchRange } from "./pwned-rules.ts"

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const BODY = ["0018A45C4D1DEF81644B54AB7F969B88D65:1", "1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824", "00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0", ""].join("\r\n")

test("only the 5-character prefix is sent, padding is asked for and dropped", async () => {
  const seen: { url: string; pad: string | null }[] = []
  const f = (async (url: string, init: RequestInit) => {
    seen.push({ url, pad: new Headers(init.headers).get("add-padding") })
    return new Response(BODY)
  }) as unknown as typeof fetch
  assert.equal(await pwnedCount("password", f), 9545824)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, "https://api.pwnedpasswords.com/range/5BAA6")
  assert.equal(seen[0].pad, "true")
  assert.ok(!seen[0].url.toLowerCase().includes("1e4c9b93"))
  assert.equal(await fetchRange("5BAA6", f), "0018A45C4D1DEF81644B54AB7F969B88D65:1\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824")
  assert.equal(await pwnedCount("a-password-nobody-used-8f3a", f), 0)
})

test("offline, error statuses and bad prefixes answer null, not an exception", async () => {
  const down = (async () => {
    throw new TypeError("fetch failed")
  }) as unknown as typeof fetch
  assert.equal(await pwnedCount("password", down), null)
  const busy = (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch
  assert.equal(await pwnedCount("password", busy), null)
  assert.equal(await fetchRange("zz", busy), null)
})

test("matching ignores case and padding lines; names that look like passwords", () => {
  assert.equal(matchRange(BODY, "1e4c9b93f3f0682250b6cf8331b7ee68fd8"), 9545824)
  assert.equal(matchRange(BODY, "00D4F6E8FA6EECAD2A3AA415EEC418D38EC"), 0)
  for (const k of ["DB_PASSWORD", "admin_pass", "PASSWD", "USER_PWD", "PASSWORD_2"]) assert.ok(looksLikePassword(k), k)
  for (const k of ["PASSPORT_ID", "API_TOKEN", "BYPASS_URL"]) assert.ok(!looksLikePassword(k), k)
})
