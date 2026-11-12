import assert from "node:assert/strict"
import { test } from "node:test"

import { DEBUG_SHA256, apkOrigin, passkeyHost } from "./passkey-rules.ts"

test("passkeys need https and a domain, but localhost works", () => {
  assert.equal(passkeyHost("https://nimbus.example.com"), "nimbus.example.com")
  assert.equal(passkeyHost("https://example.com:8443/"), "example.com")
  assert.equal(passkeyHost("http://localhost:3000"), "localhost")
  assert.equal(passkeyHost("http://nimbus.example.com"), null)
  assert.equal(passkeyHost("https://192.168.0.108"), null)
  assert.equal(passkeyHost("https://[::1]"), null)
  assert.equal(passkeyHost("https://intranet"), null)
  assert.equal(passkeyHost(undefined), null)
  assert.equal(passkeyHost("not a url"), null)
})

test("turns a keytool fingerprint into an Android origin", () => {
  assert.equal(
    apkOrigin(DEBUG_SHA256),
    "android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w"
  )
  assert.equal(apkOrigin(DEBUG_SHA256.toLowerCase()), apkOrigin(DEBUG_SHA256))
  assert.equal(apkOrigin("AA:BB"), null)
  assert.equal(apkOrigin(undefined), null)
})
