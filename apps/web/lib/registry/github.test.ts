import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { afterEach, test } from "node:test"

import { createHook, getRepo, listRepos, parseFullName, postStatus, verifySignature } from "./github.ts"

const real = globalThis.fetch
afterEach(() => (globalThis.fetch = real))

const calls: { url: string; method: string; body?: unknown; auth?: string }[] = []
function fake(answer: (url: string) => { status?: number; json?: unknown }) {
  calls.length = 0
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined, auth: (init.headers as Record<string, string>).authorization })
    const a = answer(url)
    return new Response(a.status === 204 ? null : JSON.stringify(a.json ?? {}), { status: a.status ?? 200 })
  }) as typeof fetch
}

test("signature: right secret passes, tampered body or wrong secret fails", () => {
  const body = '{"ref":"refs/heads/main"}'
  const sig = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`
  assert.equal(verifySignature("s3cret", body, sig), true)
  assert.equal(verifySignature("s3cret", body + " ", sig), false)
  assert.equal(verifySignature("other", body, sig), false)
  assert.equal(verifySignature("s3cret", body, null), false)
  assert.equal(verifySignature("s3cret", body, "sha256=00"), false)
})

test("parseFullName accepts owner/name and github.com URLs", () => {
  assert.equal(parseFullName("octo/hello"), "octo/hello")
  assert.equal(parseFullName("https://github.com/octo/hello.git"), "octo/hello")
  assert.equal(parseFullName("octo"), null)
  assert.equal(parseFullName("a/b/c"), null)
})

test("listRepos pages until a short page and maps fields", async () => {
  fake((url) => ({ json: url.endsWith("&page=1") ? Array.from({ length: 100 }, (_, i) => ({ full_name: `o/r${i}`, private: i % 2 === 0, default_branch: "main" })) : [{ full_name: "o/last", private: false, default_branch: "dev" }] }))
  const repos = await listRepos("tok")
  assert.equal(repos.length, 101)
  assert.deepEqual(repos[100], { fullName: "o/last", private: false, defaultBranch: "dev" })
  assert.equal(calls[0].auth, "Bearer tok")
})

test("createHook sends push+create with the secret and returns the id", async () => {
  fake(() => ({ json: { id: 42 } }))
  assert.equal(await createHook("tok", "o/r", "https://x/hook", "sec"), 42)
  assert.deepEqual(calls[0].body, { name: "web", active: true, events: ["push", "create"], config: { url: "https://x/hook", content_type: "json", secret: "sec", insecure_ssl: "0" } })
})

test("errors become plain messages", async () => {
  fake(() => ({ status: 401, json: { message: "Bad credentials" } }))
  await assert.rejects(listRepos("x"), /didn't accept that token/)
  fake(() => ({ status: 404 }))
  await assert.rejects(getRepo("x", "o/r"), /can't find that repository/)
  fake(() => ({ status: 403, json: { message: "Resource not accessible" } }))
  await assert.rejects(createHook("x", "o/r", "u", "s"), /Resource not accessible/)
})

test("postStatus uses the nimbus/build context and trims the description", async () => {
  fake(() => ({ json: {} }))
  await postStatus("tok", "o/r", "abc", { state: "success", url: "https://n/b", description: "x".repeat(300) })
  const b = calls[0].body as { context: string; description: string; target_url: string }
  assert.equal(b.context, "nimbus/build")
  assert.equal(b.description.length, 140)
  assert.equal(calls[0].url.endsWith("/repos/o/r/statuses/abc"), true)
})
