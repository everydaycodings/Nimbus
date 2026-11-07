import assert from "node:assert/strict"
import { test } from "node:test"

import { newer, pickApk, unwrapNotes } from "./update-rules.ts"

test("versions compare as numbers", () => {
  assert.ok(newer("0.2.2", "0.2.1"))
  assert.ok(newer("0.2.10", "0.2.9"))
  assert.ok(newer("1.0.0", "0.9.9"))
  assert.ok(!newer("0.2.1", "0.2.1"))
  assert.ok(!newer("0.2.0", "0.2.1"))
})

test("the phone's own APK, else the universal one, with bundled URLs made whole", () => {
  const release = {
    version: "0.2.2",
    files: [
      { abi: "arm64-v8a", url: "https://github.com/x/arm64.apk", size: 1 },
      { abi: "universal", url: "/android/nimbus-0.2.2-universal.apk", size: 2 },
    ],
  }
  assert.equal(pickApk(release, "arm64-v8a", "https://files.example.net")?.url, "https://github.com/x/arm64.apk")
  assert.equal(pickApk(release, "x86_64", "https://files.example.net")?.url, "https://files.example.net/android/nimbus-0.2.2-universal.apk")
  assert.equal(pickApk({ version: "1", files: [] }, "x86_64", "https://a"), null)
})

test("wrapped bullet lines in the notes join up", () => {
  assert.equal(unwrapNotes("Title\n\n- one two\n  three\n- four"), "Title\n\n- one two three\n- four")
})
