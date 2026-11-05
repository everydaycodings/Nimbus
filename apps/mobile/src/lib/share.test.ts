import assert from "node:assert/strict"
import { test } from "node:test"

import type { LinkInfo } from "@nimbus/shared/api"

import { describeUa, linkSummary, pickLink } from "./share.ts"
import { since } from "./time.ts"

const NOW = Date.parse("2026-11-05T12:00:00Z")
const link = (id: string, more: Partial<LinkInfo> = {}) =>
  ({ id, expiresAt: null, hasPassword: false, allowView: true, allowDownload: true, allowUpload: false, ...more }) as LinkInfo

test("Copy link takes the newest open link", () => {
  assert.equal(pickLink([link("old"), link("new")], NOW)?.id, "new")
})

test("Copy link prefers no password over a newer locked link", () => {
  assert.equal(pickLink([link("open"), link("locked", { hasPassword: true })], NOW)?.id, "open")
  assert.equal(pickLink([link("locked", { hasPassword: true })], NOW)?.id, "locked")
})

test("Copy link skips expired and upload-only links", () => {
  const links = [link("gone", { expiresAt: "2026-11-01T00:00:00Z" }), link("drop", { allowView: false })]
  assert.equal(pickLink(links, NOW), null)
  assert.equal(pickLink([], NOW), null)
})

test("link summary matches the web's wording", () => {
  assert.equal(linkSummary(link("a"), NOW), "Anyone with the link")
  assert.equal(linkSummary(link("a", { expiresAt: "2026-11-01T00:00:00Z" }), NOW), "Expired")
  assert.equal(linkSummary(link("a", { allowDownload: false }), NOW), "No download")
  assert.equal(linkSummary(link("a", { allowView: false, allowUpload: true }), NOW), "Uploads only")
})

test("names browsers and systems in plain words", () => {
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0"
  assert.equal(describeUa(android), "Chrome on Android")
  assert.equal(describeUa(iphone), "Safari on iPhone")
  assert.equal(describeUa(edge), "Edge on Windows")
  assert.equal(describeUa("curl/8.5.0"), null)
  assert.equal(describeUa(null), null)
})

test("relative times", () => {
  assert.equal(since("2026-11-05T11:59:40Z", NOW), "just now")
  assert.equal(since("2026-11-05T11:59:00Z", NOW), "1 minute ago")
  assert.equal(since("2026-11-05T10:00:00Z", NOW), "2 hours ago")
  assert.equal(since("2026-11-02T12:00:00Z", NOW), "3 days ago")
})
