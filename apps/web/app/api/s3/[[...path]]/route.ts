// The S3 API. Next only routes standard methods and mangles raw paths, so
// scripts/s3.ts forwards every request here as a POST carrying the real
// method and the request-target as the client signed it, plus a proof that
// nothing else can pose as it.
import { randomBytes } from "node:crypto"

import { rateLimit, s3SignIn } from "@/lib/s3api/auth"
import { corsRulesByName, corsRulesOf } from "@/lib/s3api/bucket-config"
import * as buckets from "@/lib/s3api/buckets"
import { actualHeaders, matchRule, preflightHeaders } from "@/lib/s3api/cors"
import { list } from "@/lib/s3api/list"
import { header, readXml, unwrap, type C } from "@/lib/s3api/http"
import * as mp from "@/lib/s3api/multipart"
import * as objects from "@/lib/s3api/objects"
import { listVersions } from "@/lib/s3api/versions"
import { publicBucket, publicRateLimit } from "@/lib/s3api/public"
import { record } from "@/lib/s3api/record"
import { plainIp } from "@/lib/s3api/record-rules"
import { bucketFor } from "@/lib/s3api/resolve"
import { endpoint } from "@/lib/s3api/rules"
import { S3Error, errorXml } from "@/lib/s3api/xml"
import { readToken } from "@/lib/upload-rules"

export const dynamic = "force-dynamic"

const notImplemented = (what: string) =>
  new S3Error("NotImplemented", `${what} isn't supported by this server.`, 501)

export async function POST(req: Request) {
  const proof = readToken<{ exp: number }>("s3", req.headers.get("x-s3-proxy"))
  if (!proof || proof.exp < Date.now()) return new Response(null, { status: 404 })
  const rid = randomBytes(8).toString("hex").toUpperCase()
  const method = req.headers.get("x-s3-method")?.toUpperCase() ?? ""
  const url = req.headers.get("x-s3-url") ?? "/"
  const [rawPath, rawQuery = ""] = [url.split("?")[0], url.split("?").slice(1).join("?")]
  const resource = rawPath
  const ip = plainIp(req.headers.get("x-s3-ip") || null)
  // Filled in as the request gets far enough to know who asked and which bucket.
  const seen: { keyId?: string | null; bucketId?: string; objectKey?: string | null; q?: URLSearchParams } = {}
  let res: Response
  try {
    res = await handle()
  } catch (e) {
    const s = e instanceof S3Error ? e : unwrap(e)
    if (!s) console.error(`[s3] ${method} ${url}:`, e)
    const status = s?.status ?? 500
    const body = errorXml(s?.code ?? "InternalError", s?.message ?? "We encountered an internal error. Please try again.", resource, rid)
    res = new Response(method === "HEAD" ? null : body, {
      status,
      headers: { "Content-Type": "application/xml", ...s?.headers, "x-amz-request-id": rid, "x-amz-id-2": rid, ...(status === 503 && { "Retry-After": "1" }) },
    })
  }
  // A browser's cross-origin request gets the CORS headers of the bucket's matching rule, errors included.
  const origin = req.headers.get("origin")
  if (origin && seen.bucketId && seen.keyId) {
    const rule = matchRule(await corsRulesOf(seen.bucketId).catch(() => []), origin, method)
    if (rule) {
      const h = new Headers(res.headers)
      for (const [k, v] of Object.entries(actualHeaders(rule, origin))) h.set(k, v)
      res = new Response(res.body, { status: res.status, headers: h })
    }
  }
  // Requests that never reach a bucket (ListBuckets, failed sign-in) aren't counted.
  if (seen.keyId !== undefined && seen.bucketId)
    record({
      bucketId: seen.bucketId,
      keyId: seen.keyId,
      method,
      objectKey: seen.objectKey ?? null,
      q: seen.q ?? new URLSearchParams(),
      copy: Boolean(req.headers.get("x-amz-copy-source")),
      status: res.status,
      bytesIn: Number(req.headers.get("x-amz-decoded-content-length") ?? req.headers.get("content-length")) || 0,
      bytesOut: method === "HEAD" ? 0 : Number(res.headers.get("content-length")) || 0,
      agent: req.headers.get("user-agent"),
      ip,
    })
  return res

  // Browsers send the preflight unsigned, and bucket names repeat across members, so any bucket
  // of that name with a matching rule answers it.
  async function preflight() {
    const origin = req.headers.get("origin")
    const asked = req.headers.get("access-control-request-method")
    const name = decodeURIComponent(rawPath.split("/")[1] ?? "")
    const rule = origin && asked && name ? matchRule(await corsRulesByName(name), origin, asked, (req.headers.get("access-control-request-headers") ?? "").split(",")) : undefined
    if (!rule) throw new S3Error("AccessForbidden", "CORSResponse: This CORS request is not allowed.", 403)
    return new Response(null, { status: 200, headers: { ...preflightHeaders(rule, origin!, req.headers.get("access-control-request-headers")), "x-amz-request-id": rid, "x-amz-id-2": rid } })
  }

  // /_public/<publicId>/<key>: GET and HEAD only, no listing.
  async function publicRead() {
    if (method !== "GET" && method !== "HEAD")
      throw new S3Error("MethodNotAllowed", "Public buckets can only be read with GET or HEAD.", 405, { Allow: "GET, HEAD" })
    await publicRateLimit(ip)
    const [id, ...rest] = rawPath.slice("/_public/".length).split("/")
    let key: string
    try {
      key = decodeURIComponent(rest.join("/"))
    } catch {
      throw new S3Error("InvalidURI", "Couldn't parse the specified URI.", 400)
    }
    const { who, name, bucketId } = await publicBucket(id)
    seen.keyId = null
    seen.bucketId = bucketId
    if (!key) throw new S3Error("AccessDenied", "Public buckets can't be listed.")
    seen.objectKey = key
    const c: C = { who, checked: undefined as never, req, rid, q: new URLSearchParams(), bucket: name, key, payload: "UNSIGNED-PAYLOAD" }
    const res = await objects.head(c, await bucketFor(who, name), method === "HEAD")
    // Anyone can open these, so an uploaded page can't run scripts or be sniffed into one.
    const h = new Headers(res.headers)
    h.set("Content-Security-Policy", "sandbox")
    h.set("X-Content-Type-Options", "nosniff")
    return new Response(res.body, { status: res.status, headers: h })
  }

  async function handle() {
    if (!endpoint()) throw new S3Error("ServiceUnavailable", "The S3 API isn't set up on this server.", 503)
    if (method === "OPTIONS") return preflight()
    if (rawPath.startsWith("/_public/")) return publicRead()
    const headers: Record<string, string> = {}
    req.headers.forEach((v, k) => (headers[k] = v))
    headers.host = req.headers.get("x-s3-host") ?? ""
    if (req.headers.get("x-s3-expect")) headers.expect = req.headers.get("x-s3-expect")!
    const payload = headers["x-amz-content-sha256"] ?? "UNSIGNED-PAYLOAD"
    const { who, checked } = await s3SignIn(
      { method, url, headers, payload },
      headers.authorization,
      ip
    )
    await rateLimit(who)
    seen.keyId = who.keyId

    const segs = rawPath.replace(/^\/+/, "")
    const slash = segs.indexOf("/")
    let name: string | null
    let key: string | null
    try {
      name = (slash < 0 ? segs : segs.slice(0, slash)) || null
      name = name && decodeURIComponent(name)
      key = slash < 0 ? null : decodeURIComponent(segs.slice(slash + 1))
    } catch {
      throw new S3Error("InvalidURI", "Couldn't parse the specified URI.", 400)
    }
    if (key === "") key = null
    const c: C = { who, checked, req, rid, q: new URLSearchParams(rawQuery), bucket: name, key, payload }
    const q = c.q
    seen.q = q
    seen.objectKey = key
    const unsupported = [...q.keys()].find((k) => objects.UNSUPPORTED.has(k))

    if (!name) {
      if (method === "GET") return buckets.listBuckets(c)
      throw new S3Error("MethodNotAllowed", "The specified method is not allowed against this resource.", 405)
    }

    if (key === null) {
      if (method === "PUT" && !q.size) return buckets.createBucket(c, name)
      if (method === "PUT" && q.has("versioning")) return buckets.putVersioning(c, name, await readXml(c))
      if (method === "DELETE" && !q.size) return buckets.deleteBucket(c, name)
      if (method === "HEAD") return buckets.headBucket(c, name)
      if (unsupported) throw notImplemented(`The ${unsupported} sub-resource`)
      if (method === "GET" && q.has("location")) return buckets.location(c, name)
      if (method === "GET" && q.has("versioning")) return buckets.versioning(c, name)
      const b = await bucketFor(who, name)
      seen.bucketId = b.id
      if (method === "GET" && q.has("uploads")) return mp.listUploads(c, b)
      if (method === "GET" && q.has("versions")) return listVersions(c, b)
      if (method === "GET") return list(c, b, q.get("list-type") === "2")
      if (method === "POST" && q.has("delete")) return objects.removeMany(c, b, await readXml(c))
      throw notImplemented("That bucket operation")
    }

    const b = await bucketFor(who, name)
    seen.bucketId = b.id
    if (unsupported) throw notImplemented(`The ${unsupported} sub-resource`)
    const uploadId = q.has("uploadId")
    switch (method) {
      case "GET":
        return uploadId ? mp.listParts(c, b) : objects.head(c, b, false)
      case "HEAD":
        return objects.head(c, b, true)
      case "PUT":
        if (uploadId && q.has("partNumber"))
          return header(c, "x-amz-copy-source") ? mp.uploadPartCopy(c, b) : mp.uploadPart(c, b)
        return header(c, "x-amz-copy-source") ? objects.copy(c, b) : objects.put(c, b)
      case "DELETE":
        return uploadId ? mp.abort(c, b) : objects.remove(c, b)
      case "POST":
        if (q.has("uploads")) return mp.create(c, b)
        if (uploadId) return mp.complete(c, b)
        throw notImplemented("That object operation")
      default:
        throw new S3Error("MethodNotAllowed", "The specified method is not allowed against this resource.", 405)
    }
  }
}
