// What every S3 handler gets, and how it answers.
import "server-only"

import { Readable } from "node:stream"

import type { ObjectMeta } from "@/lib/store-file"

import type { Who } from "./auth.ts"
import { chunkDecoder, hashCheck, headerChecksums, SigError, type Checked } from "./sigv4.ts"
import { S3Error, wrap } from "./xml.ts"

export type C = {
  who: Who
  checked: Checked
  req: Request
  rid: string
  // The query string as the client sent it.
  q: URLSearchParams
  bucket: string | null
  // The object key, decoded; null for bucket-level requests.
  key: string | null
  // What the signature says the body is: UNSIGNED-PAYLOAD, a sha256, or STREAMING-….
  payload: string
}

export const header = (c: C, name: string) => c.req.headers.get(name)

export function respond(c: C, status: number, body?: BodyInit | null, headers: HeadersInit = {}) {
  return new Response(body ?? null, {
    status,
    headers: { "x-amz-request-id": c.rid, "x-amz-id-2": c.rid, Server: "Nimbus", ...headers },
  })
}

export const xml = (c: C, root: string, inner: string, status = 200, headers: HeadersInit = {}) =>
  respond(c, status, wrap(root, inner), { "Content-Type": "application/xml", ...headers })

// Header values in the form S3 sends them: x-amz-meta-* as a map.
export function userMeta(c: C) {
  const m: Record<string, string> = {}
  for (const [k, v] of c.req.headers) if (k.startsWith("x-amz-meta-")) m[k.slice(11)] = v
  return Object.keys(m).length ? m : undefined
}

const STORED_HEADERS = ["cache-control", "content-disposition", "content-encoding", "content-language", "expires"]

// What a PUT, copy-with-REPLACE or multipart start stores beside the bytes:
// Content-Type, x-amz-meta-* and the caching headers. undefined when none came.
export function objectMeta(c: C): ObjectMeta | undefined {
  const contentType = header(c, "content-type")
  const user = userMeta(c)
  const headers = Object.fromEntries(STORED_HEADERS.flatMap((h) => (header(c, h) ? [[h, header(c, h)!]] : [])))
  const any = Object.keys(headers).length > 0
  return contentType || user || any ? { ...(contentType && { contentType }), ...(user && { user }), ...(any && { headers }) } : undefined
}

// If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since in RFC 7232's
// order, read from headers called `${prefix}if-…`. 412 and 304 are the answers a
// failed condition gives; null means carry on.
export function conditions(c: C, prefix: string, etag: string, at: Date): 412 | 304 | null {
  const h = (n: string) => header(c, prefix + n)
  const secs = (d: Date | string) => Math.floor((typeof d === "string" ? Date.parse(d) : d.getTime()) / 1000)
  const same = (list: string) => list.split(",").some((t) => t.trim().replace(/^W\//, "") === etag || t.trim() === "*")
  const [ifMatch, none, since, unmod] = ["if-match", "if-none-match", "if-modified-since", "if-unmodified-since"].map(h)
  if (ifMatch && !same(ifMatch)) return 412
  if (unmod && !ifMatch && secs(at) > secs(unmod)) return 412
  if (none && same(none)) return 304
  if (since && !none && secs(at) <= secs(since)) return 304
  return null
}

// The request body with its signatures and checksums being checked as it
// streams: aws-chunked decoded, a signed sha256 verified, x-amz-checksum-*
// headers compared. `declared` is the decoded size, null when not announced.
export function bodyOf(c: C): { stream: ReadableStream<Uint8Array> | null; declared: number | null } {
  const num = (n: string | null) => (n !== null && /^\d+$/.test(n) ? Number(n) : null)
  const raw = c.req.body
  if (c.payload.startsWith("STREAMING-")) {
    const signed = c.payload.startsWith("STREAMING-AWS4-HMAC-SHA256-PAYLOAD")
    const expect = (header(c, "x-amz-trailer") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    const declared = num(header(c, "x-amz-decoded-content-length"))
    if (declared === null) throw new S3Error("MissingContentLength", "x-amz-decoded-content-length is required.", 411)
    if (!raw) throw new S3Error("IncompleteBody", "The request body is missing.", 400)
    return {
      declared,
      stream: raw.pipeThrough(
        chunkDecoder({ signed: signed ? c.checked : undefined, trailer: c.payload.endsWith("-TRAILER"), expect })
      ),
    }
  }
  let stream: ReadableStream<Uint8Array> | null = raw
  if (stream && /^[0-9a-f]{64}$/.test(c.payload)) stream = stream.pipeThrough(hashCheck(c.payload))
  const want: Record<string, string> = {}
  for (const a of ["crc32", "sha1", "sha256"]) {
    const v = header(c, `x-amz-checksum-${a}`)
    if (v) want[a] = v
  }
  if (stream && Object.keys(want).length) stream = stream.pipeThrough(headerChecksums(want))
  return { stream, declared: num(header(c, "content-length")) }
}

// A small XML request body (DeleteObjects, CompleteMultipartUpload).
export async function readXml(c: C) {
  const { stream } = bodyOf(c)
  if (!stream) throw new S3Error("MalformedXML", "The request body is missing.", 400)
  const parts: Buffer[] = []
  let n = 0
  for await (const p of stream as unknown as AsyncIterable<Uint8Array>) {
    n += p.byteLength
    if (n > 2 * 1024 * 1024) throw new S3Error("MalformedXML", "The XML is too large.", 400)
    parts.push(Buffer.from(p))
  }
  return Buffer.concat(parts).toString("utf8")
}

export const nodeStream = (s: ReadableStream<Uint8Array>) => Readable.fromWeb(s as never)

// A SigError thrown inside a stream may arrive wrapped by the S3 SDK.
export function unwrap(e: unknown): SigError | null {
  for (let i = 0; e && i < 5; i++) {
    if (e instanceof SigError) return e
    e = (e as { cause?: unknown }).cause
  }
  return null
}
