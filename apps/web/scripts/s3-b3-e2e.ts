// B3 metrics and activity against the live dev stack (app :3000, S3 proxy on S3API_DOMAIN, dev Postgres/Redis). Run:
//   node --conditions=react-server --env-file=.env.local --import tsx scripts/s3-b3-e2e.ts
// Makes a bucket and key for the browser-test member, calls the flush and rollup directly, and removes everything.
import assert from "node:assert/strict"

import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { and, eq } from "drizzle-orm"

import { encrypt } from "../lib/crypto.ts"
import { db } from "../lib/db/index.ts"
import { s3Activity, s3Buckets, s3Keys, s3StorageDaily, s3Usage } from "../lib/db/schema.ts"
import { newKeyPair } from "../lib/s3api/rules.ts"
import { activity, storageTrend, top, totals, usage } from "../lib/s3api/stats.ts"
import { flushUsage, rollupUsage } from "../lib/s3api/usage.ts"

const USER = "q60pMMJNFZLzbK1EFSaeHgJhuUmgyf87" // browser-test
const BUCKET = `b3e2e-${Date.now().toString(36)}`
const step = (s: string) => console.log("-", s)

const p = newKeyPair()
const [k] = await db.insert(s3Keys).values({ userId: USER, name: "b3-e2e", accessKeyId: p.accessKeyId, secretEnc: encrypt(p.secret), access: "rw", allBuckets: true }).returning({ id: s3Keys.id })
const S = new S3Client({ endpoint: process.env.S3API_DOMAIN, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: p.accessKeyId, secretAccessKey: p.secret }, maxAttempts: 1 })
let bucketId = ""
try {
  step("traffic: 2 puts, 2 gets (one missing), 1 list, 1 delete")
  await S.send(new CreateBucketCommand({ Bucket: BUCKET }))
  ;[{ id: bucketId }] = await db.select({ id: s3Buckets.id }).from(s3Buckets).where(and(eq(s3Buckets.userId, USER), eq(s3Buckets.name, BUCKET)))
  for (const Key of ["a.txt", "b.txt"]) await S.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body: "hello world" }))
  const got = await (await S.send(new GetObjectCommand({ Bucket: BUCKET, Key: "a.txt" }))).Body!.transformToString()
  assert.equal(got, "hello world")
  await S.send(new GetObjectCommand({ Bucket: BUCKET, Key: "missing.txt" })).then(
    () => assert.fail("should 404"),
    (e) => assert.equal(e.name, "NoSuchKey")
  )
  await S.send(new ListObjectsV2Command({ Bucket: BUCKET }))
  await S.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: "b.txt" }))

  step("flush: rows land in Postgres, Redis is drained")
  await new Promise((r) => setTimeout(r, 300))
  await flushUsage()
  const rows = await db.select().from(s3Usage).where(eq(s3Usage.bucketId, bucketId))
  assert.equal(rows.length, 1)
  const u = rows[0]
  assert.equal(u.keyId, k.id)
  assert.equal(u.granularity, "h")
  assert.equal(u.hour.getTime() % 3600_000, 0)
  // 2 PUT, 1 GET ok + 1 GET missing, 1 LIST, 1 DELETE
  assert.deepEqual([u.writes, u.reads, u.lists, u.deletes, u.e4xx, u.e5xx], [2, 2, 1, 1, 1, 0])
  assert.equal(u.bytesIn, 22)
  assert.ok(u.bytesOut >= 11, `bytesOut ${u.bytesOut}`)
  assert.equal(u.agents["aws-sdk-js"], 6)
  assert.ok(Object.values(u.ips).reduce((a, b) => a + b, 0) === 6)
  const acts = await db.select().from(s3Activity).where(eq(s3Activity.bucketId, bucketId)).orderBy(s3Activity.id)
  assert.deepEqual(acts.map((a) => [a.op, a.objectKey, a.status]), [["PUT", "a.txt", 200], ["PUT", "b.txt", 200], ["GET", "missing.txt", 404], ["DELETE", "b.txt", 204]])

  step("second flush adds to the same row")
  await S.send(new GetObjectCommand({ Bucket: BUCKET, Key: "a.txt" })).then((r) => r.Body!.transformToString())
  await new Promise((r) => setTimeout(r, 300))
  await flushUsage()
  const [u2] = await db.select().from(s3Usage).where(eq(s3Usage.bucketId, bucketId))
  assert.equal(u2.reads, 3)
  assert.equal(u2.agents["aws-sdk-js"], 7)

  step("stats: usage, totals, top, activity")
  const scope = { userId: USER, bucketId }
  const day = await usage(scope, "24h")
  assert.equal(day.length, 24)
  assert.equal(day.at(-1)!.writes + day.at(-2)!.writes, 2)
  assert.equal((await usage(scope, "7d")).length, 168)
  const month = await usage(scope, "30d")
  assert.equal(month.length, 30)
  assert.equal(month.reduce((a, r) => a + r.writes, 0), 2)
  assert.equal((await usage(scope, "1y")).length, 365)
  const t = await totals(scope, "7d")
  assert.deepEqual([t.requests, t.e4xx], [7, 1])
  assert.deepEqual(await top(scope, "key", "7d"), [{ label: "b3-e2e", id: k.id, requests: 7, bytes: t.bytesIn + t.bytesOut }])
  assert.equal((await top({ userId: USER }, "bucket", "7d", 50)).find((b) => b.id === bucketId)?.label, BUCKET)
  assert.equal((await top(scope, "agent", "30d"))[0].label, "aws-sdk-js")
  assert.equal((await top(scope, "ip", "30d")).length, 1)
  const a1 = await activity(scope, {}, undefined, 3)
  assert.equal(a1.rows.length, 3)
  assert.ok(a1.next)
  assert.deepEqual(a1.rows.map((r) => r.op), ["DELETE", "GET", "PUT"])
  assert.equal(a1.rows[0].keyName, "b3-e2e")
  assert.equal(a1.rows[0].bucket, BUCKET)
  const a2 = await activity(scope, {}, a1.next!, 3)
  assert.deepEqual(a2.rows.map((r) => r.objectKey), ["a.txt"])
  assert.equal(a2.next, null)
  assert.deepEqual((await activity(scope, { errorsOnly: true })).rows.map((r) => r.status), [404])
  assert.equal((await activity(scope, { op: "PUT" })).rows.length, 2)
  assert.equal((await activity(scope, { keyId: k.id })).rows.length, 4)
  assert.equal((await activity({ userId: "someone-else", bucketId }, {})).rows.length, 0)
  assert.equal((await totals({ userId: "someone-else" }, "7d")).requests, 0)

  step("rollup: old hours fold into a day, old days and activity go, storage snapshot")
  const old = new Date(Math.floor((Date.now() - 40 * 86_400_000) / 86_400_000) * 86_400_000)
  const base = { bucketId, keyId: k.id, writes: 1, agents: { aws: 1 }, ips: { "1.1.1.1": 1 } }
  await db.insert(s3Usage).values([
    { ...base, hour: new Date(old.getTime() + 3600_000), granularity: "h" },
    { ...base, hour: new Date(old.getTime() + 5 * 3600_000), granularity: "h" },
    { ...base, hour: new Date(Date.now() - 400 * 86_400_000), granularity: "d" },
  ])
  await db.insert(s3Activity).values({ bucketId, keyId: k.id, at: new Date(Date.now() - 31 * 86_400_000), op: "PUT", status: 200 })
  await rollupUsage()
  const after = await db.select().from(s3Usage).where(eq(s3Usage.bucketId, bucketId))
  assert.equal(after.filter((r) => r.granularity === "h" && r.hour < old).length, 0)
  const folded = after.find((r) => r.granularity === "d" && r.hour.getTime() === old.getTime())!
  assert.deepEqual([folded.writes, folded.agents, folded.ips], [2, { aws: 2 }, { "1.1.1.1": 2 }])
  assert.equal(after.length, 2)
  assert.equal((await db.select().from(s3Activity).where(eq(s3Activity.bucketId, bucketId))).length, 4)
  const trend = await storageTrend(USER, bucketId)
  assert.equal(trend.length, 1)
  assert.equal(trend[0].day, new Date().toISOString().slice(0, 10))
  assert.equal(trend[0].objects, 1)
  assert.equal(trend[0].bytes, 11)
  assert.deepEqual(await storageTrend("someone-else", bucketId), [])
  await rollupUsage()
  assert.equal((await db.select().from(s3StorageDaily).where(eq(s3StorageDaily.bucketId, bucketId))).length, 1)

  console.log("ALL PASS")
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await S.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: "a.txt" })).catch(() => {})
  await S.send(new DeleteBucketCommand({ Bucket: BUCKET })).catch((e) => console.log("bucket cleanup:", e.Code ?? e.message))
  await db.delete(s3Keys).where(eq(s3Keys.id, k.id))
  process.exit(process.exitCode ?? 0)
}
