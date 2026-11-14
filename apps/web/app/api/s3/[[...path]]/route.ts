// The S3 API. Next only routes standard methods and mangles raw paths, so
// scripts/s3.ts forwards every request here as a POST carrying the real
// method and the request-target as the client signed it, plus a proof that
// nothing else can pose as it.
import { randomBytes } from "node:crypto"

import { rateLimit, s3SignIn } from "@/lib/s3api/auth"
import * as buckets from "@/lib/s3api/buckets"
import { list } from "@/lib/s3api/list"
import { header, readXml, unwrap, type C } from "@/lib/s3api/http"
import * as mp from "@/lib/s3api/multipart"
import * as objects from "@/lib/s3api/objects"
import { listVersions } from "@/lib/s3api/versions"
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
  try {
    return await handle()
  } catch (e) {
    const s = e instanceof S3Error ? e : unwrap(e)
    if (!s) console.error(`[s3] ${method} ${url}:`, e)
    const status = s?.status ?? 500
    const body = errorXml(s?.code ?? "InternalError", s?.message ?? "We encountered an internal error. Please try again.", resource, rid)
    return new Response(method === "HEAD" ? null : body, {
      status,
      headers: { "Content-Type": "application/xml", ...s?.headers, "x-amz-request-id": rid, "x-amz-id-2": rid, ...(status === 503 && { "Retry-After": "1" }) },
    })
  }

  async function handle() {
    if (!endpoint()) throw new S3Error("ServiceUnavailable", "The S3 API isn't set up on this server.", 503)
    const headers: Record<string, string> = {}
    req.headers.forEach((v, k) => (headers[k] = v))
    headers.host = req.headers.get("x-s3-host") ?? ""
    if (req.headers.get("x-s3-expect")) headers.expect = req.headers.get("x-s3-expect")!
    const payload = headers["x-amz-content-sha256"] ?? "UNSIGNED-PAYLOAD"
    const { who, checked } = await s3SignIn(
      { method, url, headers, payload },
      headers.authorization,
      req.headers.get("x-s3-ip") || null
    )
    await rateLimit(who)

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
      if (method === "GET" && q.has("uploads")) return mp.listUploads(c, b)
      if (method === "GET" && q.has("versions")) return listVersions(c, b)
      if (method === "GET") return list(c, b, q.get("list-type") === "2")
      if (method === "POST" && q.has("delete")) return objects.removeMany(c, b, await readXml(c))
      throw notImplemented("That bucket operation")
    }

    const b = await bucketFor(who, name)
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
