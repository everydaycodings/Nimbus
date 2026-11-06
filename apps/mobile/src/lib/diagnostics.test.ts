import assert from "node:assert/strict"
import { test } from "node:test"

import { diagnosticsText, maskEmail, maskHost, scrub } from "./diagnostics.ts"

test("hosts keep the scheme and port but not the name", () => {
  assert.equal(maskHost("https://files.example.net"), "https://f…")
  assert.equal(maskHost("http://192.168.1.5:3000/"), "http://1…:3000")
  assert.equal(maskHost("nonsense"), "?")
})

test("emails keep two letters", () => {
  assert.equal(maskEmail("sam@gmail.com"), "s…@g…")
  assert.equal(maskEmail("nope"), "?")
})

test("messages are scrubbed of addresses and emails", () => {
  assert.equal(scrub("no user sam@gmail.com at https://files.example.net:3400/api/x"), "no user s…@g… at https://f…:3400")
})

test("the report never holds a raw address or email", () => {
  const text = diagnosticsText({
    app: { version: "0.1.0", build: "1", runtime: "APK" },
    device: { android: "15", model: "Pixel 9" },
    accounts: [{ server: "https://files.example.net", email: "sam@gmail.com", apiVersion: 1, version: "1.2.3" }],
    push: "ntfy",
    backup: "Off",
    offlineBytes: "0 B",
    uploadQueue: 2,
    filesApp: true,
    errors: [{ at: 0, source: "api", message: "GET https://files.example.net/api/v1/me 500 for sam@gmail.com" }],
  })
  assert.ok(!text.includes("example.net") && !text.includes("sam@") && !text.includes("gmail"))
  assert.ok(text.includes("Uploads in queue: 2") && text.includes("server 1.2.3"))
})

test("the last crash is in the report with addresses and emails masked", () => {
  const input = {
    app: { version: "0.1.0", build: "1", runtime: "APK" as const },
    device: { android: "15", model: "Pixel 9" },
    accounts: [],
    push: "none",
    backup: "Off",
    offlineBytes: "0 B",
    uploadQueue: 0,
    filesApp: false,
    errors: [],
  }
  const text = diagnosticsText({ ...input, crash: { source: "native", text: "thread: main\njava.io.IOException: https://files.example.net/x for sam@gmail.com\n\tat org.nimbus.android.Net.get" } })
  assert.ok(text.includes("Last crash (native):") && text.includes("org.nimbus.android.Net.get") && text.includes("thread: main"))
  assert.ok(!text.includes("example.net") && !text.includes("sam@"))
  assert.ok(!diagnosticsText(input).includes("Last crash"))
})
