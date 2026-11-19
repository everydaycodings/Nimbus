// B4 bucket settings against the live dev stack (app :3000, S3 proxy on S3API_DOMAIN, dev Postgres/Redis).:
// Run: node --import ./scripts/no-server-only.mjs --import tsx --env-file=.env.local scripts/s3-b4-e2e.ts
import assert from "node:assert/strict"

import {
  CompleteMultipartUploadCommand, CopyObjectCommand, CreateBucketCommand, CreateMultipartUploadCommand,
  ListMultipartUploadsCommand, ListObjectVersionsCommand, ListObjectsV2Command, PutObjectCommand, S3Client, UploadPartCommand,
} from "@aws-sdk/client-s3"
import { and, eq, sql } from "drizzle-orm"

import { encrypt } from "../lib/crypto.ts"
import { db } from "../lib/db/index.ts"
import { nodes, s3Buckets, s3Keys, settings } from "../lib/db/schema.ts"
import { getBucketConfig, setCors, setLifecycle, setPublic, setQuota } from "../lib/s3api/bucket-config.ts"
import { runLifecycle } from "../lib/s3api/lifecycle.ts"
import { presignGet } from "../lib/s3api/sigv4.ts"
import { newKeyPair } from "../lib/s3api/rules.ts"
import { top } from "../lib/s3api/stats.ts"
import { flushUsage } from "../lib/s3api/usage.ts"
import { abortUploads } from "../lib/s3api/multipart.ts"
import { deleteNodes } from "../lib/uploads.ts"

const USER = "q60pMMJNFZLzbK1EFSaeHgJhuUmgyf87" // browser-test
const BUCKET = `b4e2e-${Date.now().toString(36)}`
const ENDPOINT = process.env.S3API_DOMAIN!
const MB = 1024 * 1024
const step = (s: string) => console.log("-", s)

// The setters audit with the signed-in admin, which needs a request; the write has happened by then.
const noRequest = (e: unknown) => {
  if (!/outside a request scope/.test(String((e as Error)?.message))) throw e
}
const run = <T>(p: Promise<T>) => p.catch((e) => (noRequest(e), undefined))

const p = newKeyPair()
const [k] = await db.insert(s3Keys).values({ userId: USER, name: "b4-e2e", accessKeyId: p.accessKeyId, secretEnc: encrypt(p.secret), access: "rw", allBuckets: true }).returning({ id: s3Keys.id })
const S = new S3Client({ endpoint: ENDPOINT, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: p.accessKeyId, secretAccessKey: p.secret }, maxAttempts: 1 })
const code = async (q: Promise<unknown>) => {
  try {
    await q
    return "ok"
  } catch (e) {
    return (e as { Code?: string; name?: string }).Code ?? (e as Error).name
  }
}
const put = (Key: string, Body: string | Buffer) => S.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body }))
const [orig] = await db.select({ allowed: settings.s3PublicAllowed, quota: settings.s3DefaultQuota }).from(settings)
let bucketId = ""
let nodeId = ""
const pub = async (path: string, method = "GET") => fetch(`${ENDPOINT}/_public/${path}`, { method })
const publicId = async () => (await db.select({ id: s3Buckets.publicId }).from(s3Buckets).where(eq(s3Buckets.id, bucketId)))[0].id!
try {
  await S.send(new CreateBucketCommand({ Bucket: BUCKET }))
  ;[{ id: bucketId, nodeId }] = await db.select({ id: s3Buckets.id, nodeId: s3Buckets.nodeId }).from(s3Buckets).where(and(eq(s3Buckets.userId, USER), eq(s3Buckets.name, BUCKET)))
  const big = Buffer.alloc(1_000_000, 1)
  // Refused uploads stay small: a server that answers before reading a big body may reset the connection.
  const small = Buffer.alloc(60 * 1024, 2)

  step("quota: setter checks, PUT, copy and multipart complete refused over the limit")
  assert.ok((await setQuota(USER, bucketId, 1000)).error)
  assert.ok((await setQuota("someone-else", bucketId, 5 * MB)).error)
  await run(setQuota(USER, bucketId, 1 * MB))
  assert.equal((await getBucketConfig(USER, bucketId))!.quotaBytes, 1 * MB)
  await put("a.bin", big)
  assert.equal(await code(put("b.bin", small)), "QuotaExceeded")
  assert.equal(await code(S.send(new CopyObjectCommand({ Bucket: BUCKET, Key: "c.bin", CopySource: `${BUCKET}/a.bin` }))), "QuotaExceeded")
  const mp = await S.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: "m.bin" }))
  const part = await S.send(new UploadPartCommand({ Bucket: BUCKET, Key: "m.bin", UploadId: mp.UploadId, PartNumber: 1, Body: small }))
  assert.equal(await code(S.send(new CompleteMultipartUploadCommand({ Bucket: BUCKET, Key: "m.bin", UploadId: mp.UploadId, MultipartUpload: { Parts: [{ PartNumber: 1, ETag: part.ETag }] } }))), "QuotaExceeded")
  const cfg = (await getBucketConfig(USER, bucketId))!
  assert.equal(cfg.bytes, big.length)
  await db.update(s3Buckets).set({ quotaBytes: null }).where(eq(s3Buckets.id, bucketId))
  await db.update(settings).set({ s3DefaultQuota: 1 * MB })
  assert.equal(await code(put("b.bin", small)), "QuotaExceeded", "the admin default applies")
  await db.update(settings).set({ s3DefaultQuota: orig.quota })
  assert.equal(await code(put("b.bin", small)), "ok")

  step("cors: setter checks, preflight allowed and denied, header on a signed GET")
  const rule = { origins: ["https://app.example.com"], methods: ["GET" as const, "PUT" as const], headers: ["Content-Type"], expose: ["ETag"], maxAgeSeconds: 600 }
  assert.ok((await setCors(USER, bucketId, [{ ...rule, origins: ["https://x.com/path"] }])).error)
  await run(setCors(USER, bucketId, [rule]))
  assert.deepEqual((await getBucketConfig(USER, bucketId))!.cors, [rule])
  const pre = (origin: string, method: string, headers = "content-type") =>
    fetch(`${ENDPOINT}/${BUCKET}/a.bin`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": headers } })
  const ok = await pre("https://app.example.com", "PUT")
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://app.example.com")
  assert.equal(ok.headers.get("access-control-allow-methods"), "GET, PUT")
  assert.equal(ok.headers.get("access-control-max-age"), "600")
  for (const bad of [await pre("https://evil.example.com", "PUT"), await pre("https://app.example.com", "DELETE"), await pre("https://app.example.com", "PUT", "x-secret")]) {
    assert.equal(bad.status, 403)
    assert.equal(bad.headers.get("access-control-allow-origin"), null)
  }
  const url = presignGet({ endpoint: ENDPOINT, bucket: BUCKET, key: "a.bin", accessKeyId: p.accessKeyId, secret: p.secret, region: "us-east-1", seconds: 60 })
  const withOrigin = await fetch(url, { headers: { Origin: "https://app.example.com" } })
  assert.equal(withOrigin.status, 200)
  assert.equal(withOrigin.headers.get("access-control-allow-origin"), "https://app.example.com")
  assert.equal(withOrigin.headers.get("access-control-expose-headers"), "ETag")
  assert.equal((await fetch(url, { headers: { Origin: "https://other.example.com" } })).headers.get("access-control-allow-origin"), null)
  const missing = await fetch(url.replace("a.bin", "nope.bin"), { headers: { Origin: "https://app.example.com" } })
  assert.equal(missing.status, 403, "a signature for another key fails")
  await run(setCors(USER, bucketId, []))
  assert.equal((await pre("https://app.example.com", "PUT")).status, 403, "rules gone, cache cleared")

  step("public read: refused while the admin has it off, then GET/HEAD only, no listing")
  await db.update(settings).set({ s3PublicAllowed: false })
  assert.ok((await setPublic(USER, bucketId, true)).error)
  await db.update(settings).set({ s3PublicAllowed: true })
  await run(setPublic(USER, bucketId, true))
  const id1 = await publicId()
  assert.ok(id1.length >= 16)
  assert.equal((await getBucketConfig(USER, bucketId))!.publicUrl, `${ENDPOINT}/_public/${id1}/`)
  const r = await pub(`${id1}/a.bin`)
  assert.equal(r.status, 200)
  assert.equal((await r.arrayBuffer()).byteLength, big.length)
  assert.equal((await pub(`${id1}/a.bin`, "HEAD")).status, 200)
  assert.equal((await pub(`${id1}/`)).status, 403)
  assert.equal((await pub(`${id1}`)).status, 403)
  assert.equal((await pub(`${id1}/a.bin?versionId=x`)).status, 200, "query is ignored")
  assert.equal((await pub(`${id1}/nope.bin`)).status, 404)
  for (const m of ["PUT", "POST", "DELETE"]) assert.equal((await pub(`${id1}/a.bin`, m)).status, 405, m)
  assert.equal((await pub("nosuchid/a.bin")).status, 404)
  await db.update(settings).set({ s3PublicAllowed: false })
  assert.equal((await pub(`${id1}/a.bin`)).status, 404, "admin off switches it off")
  assert.equal((await getBucketConfig(USER, bucketId))!.publicUrl, null)
  await db.update(settings).set({ s3PublicAllowed: true })
  assert.equal((await pub(`${id1}/a.bin`)).status, 200)
  await run(setPublic(USER, bucketId, true))
  assert.equal(await publicId(), id1, "turning on again keeps the URL")
  await run(setPublic(USER, bucketId, true, true))
  const id2 = await publicId()
  assert.notEqual(id2, id1)
  assert.equal((await pub(`${id1}/a.bin`)).status, 404, "old URL is dead")
  assert.equal((await pub(`${id2}/a.bin`)).status, 200)
  await flushUsage()
  assert.ok((await top({ userId: USER, bucketId }, "key", "7d")).some((t) => t.label === "Public link" && !t.id))
  await run(setPublic(USER, bucketId, false))
  assert.equal((await pub(`${id2}/a.bin`)).status, 404)

  step("lifecycle: validation, then backdated rows expire, lose old versions and abort")
  const rules = [
    { id: "exp", prefix: "logs/", expireDays: 30, noncurrentDays: null, abortMultipartDays: null },
    { id: "nc", prefix: "", expireDays: null, noncurrentDays: 10, abortMultipartDays: null },
    { id: "mp", prefix: "", expireDays: null, noncurrentDays: null, abortMultipartDays: 3 },
  ]
  assert.ok((await setLifecycle(USER, bucketId, [{ ...rules[0], expireDays: 0 }])).error)
  await run(setLifecycle(USER, bucketId, rules))
  assert.deepEqual((await getBucketConfig(USER, bucketId))!.lifecycle, rules)
  for (const key of ["logs/old.txt", "logs/new.txt", "keep.txt", "keep.txt", "keep.txt"]) await put(key, `v ${Math.random()}`)
  const ago = (key: string, days: number, which: "all" | "noncurrent") =>
    db.execute(sql`update file_versions v set created_at = now() - ${`${days} days`}::interval from nodes n
      where n.id = v.node_id and n.owner_id = ${USER} and n.name = ${key.split("/").at(-1)!}
        and ${which === "all" ? sql`true` : sql`v.id <> n.current_version_id`}`)
  await ago("old.txt", 40, "all")
  await ago("new.txt", 5, "all")
  // The old versions were made 30 and 20 days ago. The first was replaced 20 days ago; the second
  // only now (by the current one), so only the first has been noncurrent for 10+ days.
  await db.execute(sql`update file_versions v set created_at = now() - (case when r.rn = 1 then interval '30 days' else interval '20 days' end)
    from (select v2.id, row_number() over (partition by v2.node_id order by v2.number) rn from file_versions v2 join nodes n on n.id = v2.node_id
      where n.owner_id = ${USER} and n.name = 'keep.txt' and n.trashed_at is null and v2.id <> n.current_version_id) r
    where v.id = r.id`)
  const old = await S.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: "old-upload.bin" }))
  await S.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: "fresh-upload.bin" }))
  await db.execute(sql`update s3_multipart set created_at = now() - interval '5 days' where id = ${old.UploadId!}`)
  const before = await S.send(new ListObjectVersionsCommand({ Bucket: BUCKET, Prefix: "keep.txt" }))
  assert.equal(before.Versions!.length, 3)

  const res = await runLifecycle(bucketId)
  assert.deepEqual([res.trashed, res.versions, res.uploads, res.error], [1, 1, 1, null])
  const keys = ((await S.send(new ListObjectsV2Command({ Bucket: BUCKET }))).Contents ?? []).map((o) => o.Key).sort()
  assert.deepEqual(keys, ["a.bin", "b.bin", "keep.txt", "logs/new.txt"])
  assert.equal((await S.send(new ListObjectVersionsCommand({ Bucket: BUCKET, Prefix: "keep.txt" }))).Versions!.length, 2)
  assert.deepEqual(((await S.send(new ListMultipartUploadsCommand({ Bucket: BUCKET }))).Uploads ?? []).map((u) => u.Key), ["fresh-upload.bin"])
  const last = (await getBucketConfig(USER, bucketId))!.lastRun!
  assert.deepEqual([last.trashed, last.versions, last.uploads, last.error], [1, 1, 1, null])
  const again = await runLifecycle(bucketId)
  assert.deepEqual([again.trashed, again.versions, again.uploads], [0, 0, 0])
  const [trashed] = await db.select({ t: nodes.trashedAt }).from(nodes).where(and(eq(nodes.ownerId, USER), eq(nodes.name, "old.txt")))
  assert.ok(trashed.t, "expired file is in the Trash, not deleted")

  console.log("ALL PASS")
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await db.update(settings).set({ s3PublicAllowed: orig.allowed, s3DefaultQuota: orig.quota })
  if (bucketId) await abortUploads(bucketId).catch(() => {})
  if (nodeId) await deleteNodes(eq(nodes.id, nodeId)).catch((e) => console.log("cleanup:", e.message))
  await db.delete(s3Buckets).where(eq(s3Buckets.id, bucketId || "00000000-0000-0000-0000-000000000000"))
  await db.delete(s3Keys).where(eq(s3Keys.id, k.id))
  process.exit(process.exitCode ?? 0)
}
