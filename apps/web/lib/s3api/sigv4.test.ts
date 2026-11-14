// Run: node --test lib/s3api/sigv4.test.ts
import assert from "node:assert/strict"
import { createHash, createHmac } from "node:crypto"
import { test } from "node:test"
import { crc32 } from "node:zlib"

import {
  chunkDecoder,
  EMPTY_SHA256,
  SigError,
  signingKey,
  parsePresigned,
  verifyHeaderAuth,
  verifyPresigned,
} from "./sigv4.ts"

// The examples in AWS's SigV4 docs for S3.
const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
const NOW = Date.UTC(2013, 4, 24)

const getAuth =
  "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
const get = {
  method: "GET",
  url: "/test.txt",
  headers: {
    host: "examplebucket.s3.amazonaws.com",
    range: "bytes=0-9",
    "x-amz-content-sha256": EMPTY_SHA256,
    "x-amz-date": "20130524T000000Z",
  },
  payload: EMPTY_SHA256,
}

test("AWS GET object example verifies", () => {
  verifyHeaderAuth(get, getAuth, SECRET, NOW)
})

test("a wrong secret, a changed header and a stale clock are refused", () => {
  assert.throws(() => verifyHeaderAuth(get, getAuth, SECRET + "x", NOW), { code: "SignatureDoesNotMatch" })
  assert.throws(() => verifyHeaderAuth({ ...get, headers: { ...get.headers, range: "bytes=0-10" } }, getAuth, SECRET, NOW), { code: "SignatureDoesNotMatch" })
  assert.throws(() => verifyHeaderAuth(get, getAuth, SECRET, NOW + 20 * 60_000), { code: "RequestTimeTooSkewed" })
})

test("AWS GET bucket lifecycle example (query string) verifies", () => {
  verifyHeaderAuth(
    {
      method: "GET",
      url: "/?lifecycle",
      headers: { host: "examplebucket.s3.amazonaws.com", "x-amz-content-sha256": EMPTY_SHA256, "x-amz-date": "20130524T000000Z" },
      payload: EMPTY_SHA256,
    },
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;x-amz-content-sha256;x-amz-date,Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543",
    SECRET,
    NOW
  )
})

// The chunked upload example: 66560 bytes of "a" in chunks of 65536 and 1024.
const seed = "4f232c4386841ef735655705268965c44a0e4690baa4adea153f7db9fa80a0a9"
const sigs = [
  "ad80c730a21e5b8d04586a2213dd63b9a0e99e0e2307b0ade35a65485a288648",
  "0055627c9e194cb4542bae2aa5492e3c1575bbb81b612b7d234b86a503ef5497",
  "b6c6ea8a5354eaf15b3cb7646744f4275b71ea724fed81ceb9323e279d449df9",
]
const signed = {
  key: signingKey(SECRET, "20130524", "us-east-1"),
  scope: "20130524/us-east-1/s3/aws4_request",
  amzDate: "20130524T000000Z",
  seed,
}
const body = (sizes: number[], chunkSigs: string[]) =>
  Buffer.concat(
    [...sizes, 0].map((n, i) =>
      Buffer.concat([
        Buffer.from(`${n.toString(16)};chunk-signature=${chunkSigs[i]}\r\n`),
        Buffer.alloc(n, "a"),
        Buffer.from("\r\n"),
      ])
    )
  )

async function run(input: Buffer, opts: Parameters<typeof chunkDecoder>[0], piece = 1000) {
  const t = chunkDecoder(opts)
  const w = t.writable.getWriter()
  const out: Buffer[] = []
  const reader = (async () => {
    for await (const c of t.readable as unknown as AsyncIterable<Uint8Array>) out.push(Buffer.from(c))
  })()
  const writing = (async () => {
    for (let i = 0; i < input.length; i += piece) await w.write(input.subarray(i, i + piece))
    await w.close()
  })()
  await Promise.all([writing, reader])
  return Buffer.concat(out)
}

test("AWS chunked example: every chunk signature checks out, in odd-sized pieces", async () => {
  const out = await run(body([65536, 1024], sigs), { signed }, 777)
  assert.equal(out.length, 66560)
  assert.ok(out.every((b) => b === 97))
})

test("a tampered chunk or signature errors the stream", async () => {
  const b = body([65536, 1024], sigs)
  b[100] = 98
  await assert.rejects(run(b, { signed }), SigError)
  await assert.rejects(run(body([65536, 1024], [sigs[0], sigs[1].replace(/^0/, "1"), sigs[2]]), { signed }), { code: "SignatureDoesNotMatch" })
})

test("unsigned chunks with a trailing crc32 are checked", async () => {
  const data = Buffer.from("hello world")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(data))
  const make = (v: string) =>
    Buffer.concat([Buffer.from(`${data.length.toString(16)}\r\n`), data, Buffer.from(`\r\n0\r\nx-amz-checksum-crc32:${v}\r\n\r\n`)])
  const opts = { trailer: true, expect: ["x-amz-checksum-crc32"] }
  assert.equal((await run(make(crc.toString("base64")), opts)).toString(), "hello world")
  await assert.rejects(run(make("AAAAAA=="), opts), { code: "BadDigest" })
})

test("signed chunks with a signed trailer chain through the trailer", async () => {
  const data = Buffer.from("trailer data")
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex")
  const sign = (s: string) => createHmac("sha256", signed.key).update(s).digest("hex")
  const chunkSts = (prev: string, h: string) => ["AWS4-HMAC-SHA256-PAYLOAD", signed.amzDate, signed.scope, prev, EMPTY_SHA256, h].join("\n")
  const s1 = sign(chunkSts(seed, sha(data)))
  const s2 = sign(chunkSts(s1, sha("")))
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(data))
  const line = `x-amz-checksum-crc32:${crc.toString("base64")}`
  const ts = sign(["AWS4-HMAC-SHA256-TRAILER", signed.amzDate, signed.scope, s2, sha(line + "\n")].join("\n"))
  const wire = (t: string) =>
    Buffer.concat([
      Buffer.from(`${data.length.toString(16)};chunk-signature=${s1}\r\n`),
      data,
      Buffer.from(`\r\n0;chunk-signature=${s2}\r\n${line}\r\nx-amz-trailer-signature:${t}\r\n\r\n`),
    ])
  const opts = { signed, trailer: true, expect: ["x-amz-checksum-crc32"] }
  assert.equal((await run(wire(ts), opts)).toString(), "trailer data")
  await assert.rejects(run(wire((ts[0] === "0" ? "1" : "0") + ts.slice(1)), opts), { code: "SignatureDoesNotMatch" })
})

test("a body that stops early is an error", async () => {
  await assert.rejects(run(Buffer.from("5\r\nhel"), {}), { code: "IncompleteBody" })
})

// AWS's presigned GET example: https://examplebucket.s3.amazonaws.com/test.txt, valid 24 hours.
const presignedQuery =
  "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
const presigned = (q = presignedQuery) => ({
  req: { method: "GET", url: "/test.txt?" + q, headers: { host: "examplebucket.s3.amazonaws.com" }, payload: "UNSIGNED-PAYLOAD" },
  p: parsePresigned(new URLSearchParams(q))!,
})

test("AWS presigned GET example verifies, and expires", () => {
  const { req, p } = presigned()
  verifyPresigned(req, p, SECRET, NOW + 60_000)
  verifyPresigned(req, p, SECRET, NOW + 86_400_000)
  assert.throws(() => verifyPresigned(req, p, SECRET, NOW + 86_400_001), { code: "AccessDenied", message: "Request has expired." })
  assert.throws(() => verifyPresigned(req, p, SECRET, NOW - 20 * 60_000), { code: "AccessDenied" })
  assert.throws(() => verifyPresigned(req, p, SECRET + "x", NOW), { code: "SignatureDoesNotMatch" })
  assert.throws(() => verifyPresigned({ ...req, url: "/other.txt?" + presignedQuery }, p, SECRET, NOW), { code: "SignatureDoesNotMatch" })
})

test("presigned expiry over a week is refused", () => {
  assert.throws(() => presigned(presignedQuery.replace("86400", "604801")), { code: "AuthorizationQueryParametersError" })
})
