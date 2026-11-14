// AWS Signature Version 4 for the S3 API: checking a request's signature, and
// decoding the aws-chunked bodies newer clients send (per-chunk signatures,
// trailing checksums). Pure Node, no app imports, so node --test loads it.
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { crc32 } from "node:zlib"

export const SKEW_MS = 15 * 60_000
export const EMPTY_SHA256 = createHash("sha256").digest("hex")

// What the protocol layer turns into an XML error.
export class SigError extends Error {
  code: string
  status: number
  // Extra response headers (x-amz-delete-marker on a marker's 404 and 405).
  headers?: Record<string, string>
  constructor(code: string, message: string, status = 403, headers?: Record<string, string>) {
    super(message)
    this.code = code
    this.status = status
    this.headers = headers
  }
}

const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest()
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex")

export function signingKey(secret: string, date: string, region: string, service = "s3") {
  return hmac(hmac(hmac(hmac("AWS4" + secret, date), region), service), "aws4_request")
}

// RFC 3986 encoding, as SigV4 wants (encodeURIComponent leaves ! ' ( ) * alone).
const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())

const dec = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, "%20"))
  } catch {
    return s
  }
}

export type Parsed = {
  accessKeyId: string
  date: string
  region: string
  service: string
  signedHeaders: string[]
  signature: string
}

// "AWS4-HMAC-SHA256 Credential=AKID/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=…"
export function parseAuthorization(header: string): Parsed | null {
  const m = header.match(/^AWS4-HMAC-SHA256\s+(.*)$/)
  if (!m) return null
  const f = Object.fromEntries(
    m[1].split(",").map((p) => {
      const i = p.indexOf("=")
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    })
  )
  const [accessKeyId, date, region, service, term] = (f.Credential ?? "").split("/")
  if (!accessKeyId || !date || !region || !service || term !== "aws4_request") return null
  if (!f.SignedHeaders || !f.Signature) return null
  return { accessKeyId, date, region, service, signedHeaders: f.SignedHeaders.split(";"), signature: f.Signature }
}

// Both spellings of the path a client may have signed: as sent, and decoded
// and re-encoded (what AWS does, so a client that over- or under-encodes works).
function paths(rawPath: string) {
  const again = rawPath.split("/").map((s) => enc(dec(s))).join("/")
  return again === rawPath ? [rawPath] : [again, rawPath]
}

export function canonicalQuery(rawQuery: string, skip?: string) {
  if (!rawQuery) return ""
  return rawQuery
    .split("&")
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=")
      const k = dec(i < 0 ? p : p.slice(0, i))
      return [enc(k), enc(i < 0 ? "" : dec(p.slice(i + 1))), k] as const
    })
    .filter(([, , k]) => k !== skip)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
}

export type Signed = {
  method: string
  // The request-target exactly as the client sent it, query included.
  url: string
  // Header values by lowercase name; `host` is the one the client signed.
  headers: Record<string, string | undefined>
  // The payload hash the signature covers: hex, UNSIGNED-PAYLOAD or STREAMING-….
  payload: string
}

export function canonicalRequests(r: Signed, p: Pick<Parsed, "signedHeaders">, skipQuery?: string) {
  const q = r.url.indexOf("?")
  const path = q < 0 ? r.url : r.url.slice(0, q)
  const query = canonicalQuery(q < 0 ? "" : r.url.slice(q + 1), skipQuery)
  const heads = p.signedHeaders
    .map((h) => `${h}:${(r.headers[h] ?? "").trim().replace(/\s+/g, " ")}\n`)
    .join("")
  return paths(path || "/").map((cp) =>
    [r.method, cp, query, heads, p.signedHeaders.join(";"), r.payload].join("\n")
  )
}

export const stringToSign = (amzDate: string, scope: string, canonical: string) =>
  ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n")

export function same(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export type Checked = { key: Buffer; scope: string; amzDate: string; seed: string }

// Header auth. Throws SigError; returns what chunk signatures chain from.
export function verifyHeaderAuth(
  r: Signed,
  authorization: string,
  secret: string,
  now = Date.now()
): Checked {
  const p = parseAuthorization(authorization)
  if (!p) throw new SigError("AuthorizationHeaderMalformed", "The authorization header is malformed.", 400)
  const amzDate = r.headers["x-amz-date"] ?? ""
  return verifyParsed(r, p, secret, amzDate, now)
}

export function verifyParsed(r: Signed, p: Parsed, secret: string, amzDate: string, now: number, skipQuery?: string): Checked {
  const t = amzDate.match(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/)
  if (!t) throw new SigError("AccessDenied", "A valid x-amz-date header is required.")
  if (!amzDate.startsWith(p.date)) throw new SigError("AuthorizationHeaderMalformed", "The credential date doesn't match x-amz-date.", 400)
  const sent = Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +t[6])
  if (Math.abs(now - sent) > SKEW_MS)
    throw new SigError("RequestTimeTooSkewed", "The difference between the request time and the server's time is too large.")
  const scope = [p.date, p.region, p.service, "aws4_request"].join("/")
  const key = signingKey(secret, p.date, p.region, p.service)
  for (const c of canonicalRequests(r, p, skipQuery)) {
    const sig = createHmac("sha256", key).update(stringToSign(amzDate, scope, c)).digest("hex")
    if (same(sig, p.signature)) return { key, scope, amzDate, seed: p.signature }
  }
  throw new SigError("SignatureDoesNotMatch", "The request signature we calculated does not match the signature you provided. Check your key and signing method.")
}

// Query auth (presigned URLs): the same signature carried in X-Amz-* query
// parameters, valid for X-Amz-Expires seconds from X-Amz-Date, body unsigned.
export const MAX_EXPIRES = 604800

export function parsePresigned(q: URLSearchParams): { parsed: Parsed; amzDate: string; expires: number } | null {
  const sig = q.get("X-Amz-Signature")
  if (!sig) return null
  const bad = (m: string) => new SigError("AuthorizationQueryParametersError", m, 400)
  if (q.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256") throw bad("X-Amz-Algorithm only supports \"AWS4-HMAC-SHA256\".")
  const [accessKeyId, date, region, service, term] = (q.get("X-Amz-Credential") ?? "").split("/")
  const signed = q.get("X-Amz-SignedHeaders")
  const expires = Number(q.get("X-Amz-Expires"))
  if (!accessKeyId || !date || !region || !service || term !== "aws4_request" || !signed) throw bad("The X-Amz-Credential or X-Amz-SignedHeaders parameter is malformed.")
  if (!Number.isInteger(expires) || expires < 1) throw bad("X-Amz-Expires must be a number of seconds.")
  if (expires > MAX_EXPIRES) throw bad("X-Amz-Expires must be less than a week (in seconds); that is, the given X-Amz-Expires must be less than 604800 seconds.")
  return {
    parsed: { accessKeyId, date, region, service, signedHeaders: signed.split(";"), signature: sig },
    amzDate: q.get("X-Amz-Date") ?? "",
    expires,
  }
}

export function verifyPresigned(r: Signed, p: NonNullable<ReturnType<typeof parsePresigned>>, secret: string, now = Date.now()): Checked {
  const t = p.amzDate.match(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/)
  if (!t) throw new SigError("AuthorizationQueryParametersError", "X-Amz-Date must be in the ISO8601 Long Format \"yyyyMMdd'T'HHmmss'Z'\".", 400)
  const sent = Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +t[6])
  if (sent - now > SKEW_MS) throw new SigError("AccessDenied", "Request is not yet valid.")
  if (now > sent + p.expires * 1000) throw new SigError("AccessDenied", "Request has expired.")
  // The expiry window replaces the clock-skew rule, so the signature check is told it is "now".
  return verifyParsed({ ...r, payload: "UNSIGNED-PAYLOAD" }, p.parsed, secret, p.amzDate, sent, "X-Amz-Signature")
}

// ---- aws-chunked bodies ---------------------------------------------------

// Checksums a trailer (or header) may carry. crc32c and crc64nvme aren't in
// Node's stdlib: they're accepted but not verified.
// ponytail: crc32c/crc64nvme trust the client; add a table-driven version if they must be checked.
export const CHECKSUMS = ["crc32", "sha1", "sha256"] as const

export function checksummer(algos: string[]) {
  const use = algos.filter((a) => (CHECKSUMS as readonly string[]).includes(a))
  const hashes = new Map(use.filter((a) => a !== "crc32").map((a) => [a, createHash(a)]))
  let crc = 0
  return {
    update(chunk: Uint8Array) {
      if (use.includes("crc32")) crc = crc32(chunk, crc)
      for (const h of hashes.values()) h.update(chunk)
    },
    // Base64, the way x-amz-checksum-* carries it; null for algorithms we don't compute.
    digest(a: string) {
      if (a === "crc32") return use.includes(a) ? Buffer.from([crc >>> 24, crc >>> 16, crc >>> 8, crc].map((b) => b & 255)).toString("base64") : null
      return hashes.get(a)?.copy().digest("base64") ?? null
    },
  }
}

export type ChunkOptions = {
  // Signed chunks chain from the request signature; unsigned ones don't.
  signed?: { key: Buffer; scope: string; amzDate: string; seed: string }
  // The body ends with trailing headers (signed too when `signed` is set).
  trailer?: boolean
  // Checksums to expect in the trailer, from the x-amz-trailer header.
  expect?: string[]
}

const bad = (msg: string) => new SigError("IncompleteBody", msg, 400)

// Decodes aws-chunked into the plain bytes, checking each chunk's signature
// and the trailing checksums as they pass. A failure errors the stream, so the
// upload downstream aborts before anything is stored.
export function chunkDecoder(o: ChunkOptions = {}) {
  const sums = checksummer((o.expect ?? []).map((h) => h.replace(/^x-amz-checksum-/, "")))
  let buf: Buffer = Buffer.alloc(0)
  let state: "head" | "data" | "crlf" | "trailer" = "head"
  let left = 0
  let sig = ""
  let prev = o.signed?.seed ?? ""
  let chunk = createHash("sha256")
  const chunkSts = (hash: string) =>
    ["AWS4-HMAC-SHA256-PAYLOAD", o.signed!.amzDate, o.signed!.scope, prev, EMPTY_SHA256, hash].join("\n")
  const sign = (sts: string) => createHmac("sha256", o.signed!.key).update(sts).digest("hex")
  let ended = false

  function finishTrailer() {
    const lines = buf.toString("utf8").split("\r\n").filter(Boolean)
    const got = new Map(lines.map((l) => [l.slice(0, l.indexOf(":")).trim().toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]))
    if (o.signed) {
      const theirs = got.get("x-amz-trailer-signature") ?? ""
      const canon = lines.filter((l) => !/^x-amz-trailer-signature:/i.test(l)).map((l) => l + "\n").join("")
      const sts = ["AWS4-HMAC-SHA256-TRAILER", o.signed.amzDate, o.signed.scope, prev, sha256(canon)].join("\n")
      if (!same(sign(sts), theirs)) throw new SigError("SignatureDoesNotMatch", "The trailer signature does not match.")
    }
    for (const [name, value] of got) {
      const m = name.match(/^x-amz-checksum-(.+)$/)
      const mine = m && sums.digest(m[1])
      if (mine && mine !== value) throw new SigError("BadDigest", `The ${m[1]} you specified did not match the calculated checksum.`, 400)
    }
    ended = true
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(part, ctl) {
      buf = buf.length ? Buffer.concat([buf, part]) : Buffer.from(part.buffer, part.byteOffset, part.byteLength)
      for (;;) {
        if (state === "head") {
          const i = buf.indexOf("\r\n")
          if (i < 0) {
            if (buf.length > 4096) throw bad("Malformed chunk header.")
            return
          }
          const [size, ext] = buf.subarray(0, i).toString("ascii").split(";")
          left = parseInt(size, 16)
          if (!/^[0-9a-fA-F]+$/.test(size) || !Number.isFinite(left)) throw bad("Malformed chunk header.")
          sig = ext?.match(/chunk-signature=([0-9a-f]+)/)?.[1] ?? ""
          if (o.signed && !sig) throw bad("A chunk signature is missing.")
          buf = buf.subarray(i + 2)
          chunk = createHash("sha256")
          if (left === 0) {
            if (o.signed) {
              if (!same(sign(chunkSts(sha256(""))), sig)) throw new SigError("SignatureDoesNotMatch", "The chunk signature does not match.")
              prev = sig
            }
            state = "trailer"
          } else state = "data"
        } else if (state === "data") {
          if (!buf.length) return
          const n = Math.min(left, buf.length)
          const piece = buf.subarray(0, n)
          buf = buf.subarray(n)
          left -= n
          if (o.signed) chunk.update(piece)
          sums.update(piece)
          ctl.enqueue(new Uint8Array(piece))
          if (!left) state = "crlf"
        } else if (state === "crlf") {
          if (buf.length < 2) return
          if (buf[0] !== 13 || buf[1] !== 10) throw bad("Malformed chunk.")
          buf = buf.subarray(2)
          if (o.signed) {
            if (!same(sign(chunkSts(chunk.digest("hex"))), sig)) throw new SigError("SignatureDoesNotMatch", "The chunk signature does not match.")
            prev = sig
          }
          state = "head"
        } else return // trailer: collected until the end
      }
    },
    flush() {
      if (state !== "trailer") throw bad("The body ended before the last chunk.")
      if (o.trailer) finishTrailer()
      else ended = true
      if (!ended) throw bad("Malformed body.")
    },
  })
}

// Verifies the payload hash the client signed (hex form) as the bytes pass.
export function hashCheck(expected: string) {
  const h = createHash("sha256")
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(c, ctl) {
      h.update(c)
      ctl.enqueue(c)
    },
    flush() {
      if (!same(h.digest("hex"), expected))
        throw new SigError("XAmzContentSHA256Mismatch", "The provided 'x-amz-content-sha256' header does not match what was computed.", 400)
    },
  })
}

// Verifies x-amz-checksum-* values sent as plain headers.
export function headerChecksums(want: Record<string, string>) {
  const sums = checksummer(Object.keys(want))
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(c, ctl) {
      sums.update(c)
      ctl.enqueue(c)
    },
    flush() {
      for (const [a, v] of Object.entries(want)) {
        const mine = sums.digest(a)
        if (mine && mine !== v) throw new SigError("BadDigest", `The ${a} you specified did not match the calculated checksum.`, 400)
      }
    },
  })
}
