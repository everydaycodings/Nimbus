import assert from "node:assert/strict"
import { test } from "node:test"

import { systemFirst, systemIn, systemLabel, systemWarning } from "./system-folders.ts"

test("labels", () => {
  assert.equal(systemLabel("camera"), "Auto · Photo backup")
  assert.equal(systemLabel("phone_backup"), "Auto · Contacts and calendar")
  assert.equal(systemLabel("partner"), "Auto · Partner photos")
})

test("warnings name the folder and the action", () => {
  assert.equal(systemWarning("camera", "rename"), "Photo backup puts new photos in Camera. If you rename it, the next backup makes a new Camera folder.")
  assert.match(systemWarning("phone_backup", "move"), /move it.*Phone backup/)
  assert.match(systemWarning("partner", "delete"), /delete it/)
})

test("systemFirst is stable and systemIn finds a kind", () => {
  const a = [{ id: 1 }, { id: 2, system: "partner" as const }, { id: 3 }, { id: 4, system: "camera" as const }]
  assert.deepEqual(systemFirst(a).map((i) => i.id), [2, 4, 1, 3])
  assert.equal(systemIn(a), "partner")
  assert.equal(systemIn([{}]), undefined)
})
