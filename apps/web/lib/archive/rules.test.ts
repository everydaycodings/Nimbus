import assert from "node:assert/strict"
import test from "node:test"

import { cleanDomain, cleanUrl, cookieDomainFor, fileName, parseBookmarks, parseCookieHeader, parseUrlList, textHash } from "./rules.ts"

test("cleanUrl: web addresses only, no logins", () => {
  assert.equal(cleanUrl(" https://example.com/a?b=1 "), "https://example.com/a?b=1")
  assert.equal(cleanUrl("javascript:alert(1)"), null)
  assert.equal(cleanUrl("file:///etc/passwd"), null)
  assert.equal(cleanUrl("https://u:p@example.com"), null)
  assert.equal(cleanUrl("nope"), null)
})

test("parseUrlList: one per line, dupes and junk apart", () => {
  const r = parseUrlList("https://a.com\n\nhttps://a.com\nftp://x\nhttps://b.com/x")
  assert.deepEqual(r.urls, ["https://a.com/", "https://b.com/x"])
  assert.deepEqual(r.bad, ["ftp://x"])
})

const BOOKMARKS = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Bookmarks bar</H3>
  <DL><p>
    <DT><H3>Reading &amp; Learning</H3>
    <DL><p>
      <DT><A HREF="https://example.com/a?x=1&amp;y=2" ADD_DATE="1" TAGS="Rust, web">Post &quot;A&quot;</A>
      <DT><A HREF="https://example.com/a?x=1&amp;y=2">dupe</A>
    </DL><p>
    <DT><A HREF="javascript:void(0)">bookmarklet</A>
    <DT><A HREF='https://b.org/'>B</A>
  </DL><p>
</DL><p>`

test("parseBookmarks: attributes, folders as tags, root names dropped", () => {
  const r = parseBookmarks(BOOKMARKS)
  assert.equal(r.length, 2)
  assert.deepEqual(r[0], { url: "https://example.com/a?x=1&y=2", title: 'Post "A"', tags: ["rust", "web", "reading & learning"] })
  assert.deepEqual(r[1], { url: "https://b.org/", title: "B", tags: [] })
})

test("textHash ignores spacing; fileName is safe", () => {
  assert.equal(textHash("a  b\n c"), textHash(" a b c "))
  assert.notEqual(textHash("a b"), textHash("a c"))
  assert.equal(fileName('A/B: "c"', new Date("2026-11-20T14:05:09Z"), "pdf"), "A B c (2026-11-20 1405).pdf")
})

test("cookies: header parsing, domain matching, typed domains", () => {
  assert.deepEqual(parseCookieHeader("Cookie: a=1; b=x=y; junk"), [{ name: "a", value: "1" }, { name: "b", value: "x=y" }])
  assert.equal(cookieDomainFor("blog.example.com", ["example.com", "other.com", "blog.example.com"]), "blog.example.com")
  assert.equal(cookieDomainFor("notexample.com", ["example.com"]), null)
  assert.equal(cleanDomain("https://www.Example.com/x"), "example.com")
  assert.equal(cleanDomain("not a domain"), null)
})
