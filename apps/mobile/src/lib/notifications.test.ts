import assert from "node:assert/strict"
import { test } from "node:test"

import { notificationTarget } from "./notifications.ts"

test("admin alerts open the web", () => {
  assert.deepEqual(notificationTarget({ kind: "signup_request", href: "/admin/approvals", nodeId: null }), { to: "browser", path: "/admin/approvals" })
  assert.deepEqual(notificationTarget({ kind: "backup", href: "/admin/system/backups/history?run=4", nodeId: null }), { to: "browser", path: "/admin/system/backups/history?run=4" })
})

test("account and storage alerts open their screens", () => {
  assert.deepEqual(notificationTarget({ kind: "app_password", href: "/account#connect", nodeId: null }), { to: "route", path: "/account/devices" })
  assert.deepEqual(notificationTarget({ kind: "storage_low", href: "/storage", nodeId: null }), { to: "route", path: "/storage" })
})

test("the rest go to their item, or Shared when there's none", () => {
  assert.deepEqual(notificationTarget({ kind: "shared", href: "/shared", nodeId: "n1" }), { to: "item", id: "n1" })
  assert.deepEqual(notificationTarget({ kind: "access_removed", href: "/shared", nodeId: null }), { to: "route", path: "/(tabs)/(shared)/home" })
})
