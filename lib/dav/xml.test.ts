// Run: node --test lib/dav/xml.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import {
  href,
  ifHolds,
  ifTokens,
  lockOwner,
  multistatus,
  parseIf,
  patchedProps,
  timeout,
} from "./xml.ts"

test("hrefs encode each segment and mark folders", () => {
  assert.equal(href("/dav/", [], true), "/dav/")
  assert.equal(href("/dav/", ["My docs", "a#b.txt"], false), "/dav/My%20docs/a%23b.txt")
  assert.equal(href("/dav/", ["Photos"], true), "/dav/Photos/")
})

test("multistatus escapes names and lists file props", () => {
  const x = multistatus([
    {
      href: "/dav/a%26b.txt",
      name: "a&b.txt",
      folder: false,
      size: 5,
      mime: "text/plain",
      created: new Date(0),
      modified: new Date(0),
      etag: "v1",
    },
  ])
  assert.match(x, /<D:displayname>a&amp;b\.txt<\/D:displayname>/)
  assert.match(x, /<D:getcontentlength>5<\/D:getcontentlength>/)
  assert.match(x, /<D:resourcetype\/>/)
  assert.match(x, /<D:getetag>"v1"<\/D:getetag>/)
})

test("proppatch names come back with their namespaces", () => {
  const body = `<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:"><D:set><D:prop><Z:Win32LastModifiedTime>x</Z:Win32LastModifiedTime><D:getlastmodified>y</D:getlastmodified></D:prop></D:set></D:propertyupdate>`
  assert.deepEqual(patchedProps(body), [
    ["urn:schemas-microsoft-com:", "Win32LastModifiedTime"],
    ["DAV:", "getlastmodified"],
  ])
})

test("lock details", () => {
  assert.equal(
    lockOwner(`<D:lockinfo xmlns:D="DAV:"><D:owner><D:href>me</D:href></D:owner></D:lockinfo>`),
    "<D:href>me</D:href>"
  )
  assert.deepEqual(
    [...ifTokens(`</dav/a> (<opaquelocktoken:abc>) (<urn:uuid:def>)`)],
    ["opaquelocktoken:abc", "urn:uuid:def"]
  )
  assert.equal(timeout("Infinite, Second-4100000000"), 3600)
  assert.equal(timeout("Second-120"), 120)
  assert.equal(timeout(null), 3600)
})

test("If headers: lists are OR, conditions AND, Not flips, etags count", () => {
  const held = new Set(["opaquelocktoken:abc"])
  const holds = (h: string, etag = "v1") => ifHolds(parseIf(h), held, etag)
  assert.equal(holds(""), true)
  assert.equal(holds("(<opaquelocktoken:abc>)"), true)
  assert.equal(holds("(<opaquelocktoken:wrong>)"), false)
  assert.equal(holds("(<DAV:no-lock>)"), false)
  assert.equal(holds("(<opaquelocktoken:abc>) (Not <DAV:no-lock>)"), true)
  assert.equal(holds('(<opaquelocktoken:abc> ["v1"])'), true)
  assert.equal(holds('(<opaquelocktoken:abc> ["stale"])'), false)
  assert.equal(holds('(<opaquelocktoken:abc> ["stale"]) (Not <DAV:no-lock> ["stale"])'), false)
  assert.equal(holds('(<opaquelocktoken:abc> ["v1"]) (Not <DAV:no-lock> ["v1"])'), true)
  assert.equal(holds('</dav/a.txt> (<opaquelocktoken:abc>)'), true)
  assert.equal(holds('([W/"v1"])'), true)
})
