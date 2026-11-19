// B2 key controls against the live dev stack (app :3000, S3 proxy on S3API_DOMAIN, dev Postgres/Redis). Run:
//   node --require $STUB --env-file=.env.local --import tsx scripts/s3-b2-e2e.ts
// $STUB: a CJS file that makes require("server-only") a no-op. Makes a bucket and keys for the browser-test member and removes them.
import assert from "node:assert/strict"

import { CopyObjectCommand, CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { and, eq, inArray } from "drizzle-orm"

import { encrypt } from "../lib/crypto.ts"
import { db } from "../lib/db/index.ts"
import { notifications, s3Keys } from "../lib/db/schema.ts"
import { remindKeys } from "../lib/s3api/reminders.ts"
import { newKeyPair } from "../lib/s3api/rules.ts"

const USER = "q60pMMJNFZLzbK1EFSaeHgJhuUmgyf87" // browser-test
const BUCKET = `b2e2e-${Date.now().toString(36)}`
const step = (s: string) => console.log("-", s)
const made: string[] = []

async function key(o: Partial<typeof s3Keys.$inferInsert> = {}) {
  const p = newKeyPair()
  const [k] = await db.insert(s3Keys).values({ userId: USER, name: "b2-e2e", accessKeyId: p.accessKeyId, secretEnc: encrypt(p.secret), access: "rw", allBuckets: true, ...o }).returning({ id: s3Keys.id })
  made.push(k.id)
  return { id: k.id, ...p }
}
const client = (id: string, secret: string) =>
  new S3Client({ endpoint: process.env.S3API_DOMAIN, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: id, secretAccessKey: secret }, maxAttempts: 1 })
const code = async (p: Promise<unknown>) => {
  try {
    await p
    return "ok"
  } catch (e) {
    return (e as { Code?: string; name?: string }).Code ?? (e as Error).name
  }
}
const put = (c: S3Client, Key: string) => c.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body: `body of ${Key}` }))
const get = async (c: S3Client, Key: string) => (await c.send(new GetObjectCommand({ Bucket: BUCKET, Key }))).Body!.transformToString()
const keys = async (c: S3Client, Prefix?: string) => ((await c.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix }))).Contents ?? []).map((o) => o.Key).sort()

const full = await key()
const F = client(full.accessKeyId, full.secret)
try {
  step("full key: create bucket and objects")
  await F.send(new CreateBucketCommand({ Bucket: BUCKET }))
  for (const k of ["a/x.txt", "a/deep/y.txt", "other/z.txt"]) await put(F, k)
  assert.deepEqual(await keys(F), ["a/deep/y.txt", "a/x.txt", "other/z.txt"])

  step("append-only key: list/read/write ok, delete denied")
  const ap = await key({ perms: ["list", "read", "write"] })
  const A = client(ap.accessKeyId, ap.secret)
  assert.equal(await code(put(A, "a/append.txt")), "ok")
  assert.equal(await get(A, "a/append.txt"), "body of a/append.txt")
  assert.equal(await code(A.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: "a/append.txt" }))), "AccessDenied")
  const dm = await A.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: [{ Key: "a/append.txt" }] } })).catch((e) => e)
  assert.equal(dm.Code ?? dm.name, "AccessDenied")
  assert.equal(await code(A.send(new DeleteBucketCommand({ Bucket: BUCKET }))), "AccessDenied")

  step("read-only key: write denied, read ok")
  const ro = await key({ perms: ["list", "read"], access: "ro" })
  const R = client(ro.accessKeyId, ro.secret)
  assert.equal(await code(put(R, "a/nope.txt")), "AccessDenied")
  assert.equal(await code(R.send(new CreateBucketCommand({ Bucket: BUCKET + "-x" }))), "AccessDenied")
  assert.equal(await get(R, "a/x.txt"), "body of a/x.txt")

  step("write-only key (custom): list and read denied")
  const wo = await key({ perms: ["write"] })
  const W = client(wo.accessKeyId, wo.secret)
  assert.equal(await code(put(W, "a/w.txt")), "ok")
  assert.equal(await code(get(W, "a/w.txt")), "AccessDenied")
  assert.equal(await code(keys(W)), "AccessDenied")

  step("prefix key a/: inside ok, outside denied, root listing clamped")
  const px = await key({ prefix: "a/" })
  const P = client(px.accessKeyId, px.secret)
  assert.equal(await get(P, "a/x.txt"), "body of a/x.txt")
  assert.equal(await code(get(P, "other/z.txt")), "AccessDenied")
  assert.equal(await code(put(P, "other/new.txt")), "AccessDenied")
  assert.equal(await code(put(P, "a/new.txt")), "ok")
  assert.deepEqual(await keys(P), ["a/append.txt", "a/deep/y.txt", "a/new.txt", "a/w.txt", "a/x.txt"])
  assert.deepEqual(await keys(P, "a/deep/"), ["a/deep/y.txt"])
  // Listing the root with a delimiter shows the key's prefix as the one folder, like a filtered real listing.
  const top = await P.send(new ListObjectsV2Command({ Bucket: BUCKET, Delimiter: "/" }))
  assert.deepEqual([top.Prefix ?? "", top.Contents ?? [], top.CommonPrefixes?.map((p) => p.Prefix)], ["", [], ["a/"]])
  assert.equal(await code(keys(P, "other/")), "AccessDenied")
  assert.equal(await code(P.send(new CopyObjectCommand({ Bucket: BUCKET, Key: "a/stolen.txt", CopySource: `${BUCKET}/other/z.txt` }))), "AccessDenied")
  assert.equal(await code(F.send(new CopyObjectCommand({ Bucket: BUCKET, Key: "other/copied.txt", CopySource: `${BUCKET}/a/x.txt` }))), "ok")
  assert.equal(await code(P.send(new CopyObjectCommand({ Bucket: BUCKET, Key: "other/leak.txt", CopySource: `${BUCKET}/a/x.txt` }))), "AccessDenied")
  const many = await P.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: [{ Key: "a/new.txt" }, { Key: "other/z.txt" }] } }))
  assert.deepEqual(many.Deleted?.map((d) => d.Key), ["a/new.txt"])
  assert.deepEqual(many.Errors?.map((d) => [d.Key, d.Code]), [["other/z.txt", "AccessDenied"]])
  assert.equal(await get(F, "other/z.txt"), "body of other/z.txt")
  assert.equal(await code(P.send(new DeleteBucketCommand({ Bucket: BUCKET }))), "AccessDenied")

  step("IP allow list")
  const far = await key({ allowedIps: ["10.0.0.0/8"] })
  assert.equal(await code(get(client(far.accessKeyId, far.secret), "a/x.txt")), "AccessDenied")
  const near = await key({ allowedIps: ["127.0.0.1/32", "::1"] })
  assert.equal(await get(client(near.accessKeyId, near.secret), "a/x.txt"), "body of a/x.txt")

  step("disabled key denied, enabled again works")
  const off = await key({ disabledAt: new Date() })
  const O = client(off.accessKeyId, off.secret)
  assert.equal(await code(get(O, "a/x.txt")), "AccessDenied")
  await db.update(s3Keys).set({ disabledAt: null }).where(eq(s3Keys.id, off.id))
  assert.equal(await get(O, "a/x.txt"), "body of a/x.txt")

  step("rotation grace: old secret works until the grace ends")
  const rot = await key()
  const fresh = newKeyPair().secret
  await db.update(s3Keys).set({ secretEnc: encrypt(fresh), secretPrevEnc: encrypt(rot.secret), secretPrevUntil: new Date(Date.now() + 3600_000), rotatedAt: new Date() }).where(eq(s3Keys.id, rot.id))
  assert.equal(await get(client(rot.accessKeyId, fresh), "a/x.txt"), "body of a/x.txt")
  assert.equal(await get(client(rot.accessKeyId, rot.secret), "a/x.txt"), "body of a/x.txt")
  await db.update(s3Keys).set({ secretPrevUntil: new Date(Date.now() - 1000) }).where(eq(s3Keys.id, rot.id))
  assert.equal(await code(get(client(rot.accessKeyId, rot.secret), "a/x.txt")), "SignatureDoesNotMatch")
  assert.equal(await get(client(rot.accessKeyId, fresh), "a/x.txt"), "body of a/x.txt")
  assert.equal(await code(get(client(rot.accessKeyId, newKeyPair().secret), "a/x.txt")), "SignatureDoesNotMatch")

  step("reminders: rotation due and expiring, each once")
  const due = await key({ name: "b2-e2e-due", rotateEveryDays: 1, createdAt: new Date(Date.now() - 2 * 86_400_000) })
  const exp = await key({ name: "b2-e2e-exp", expiresAt: new Date(Date.now() + 3 * 86_400_000) })
  const first = await remindKeys()
  assert.ok(first >= 2, `reminded ${first}`)
  assert.equal(await remindKeys(), 0)
  const bells = await db.select({ data: notifications.data }).from(notifications).where(and(eq(notifications.userId, USER), eq(notifications.kind, "s3_key")))
  const names = bells.map((b) => (b.data as { name?: string; what?: string })).filter((d) => d.name?.startsWith("b2-e2e-"))
  assert.ok(names.some((d) => d.name === "b2-e2e-due" && d.what === "rotation_due"))
  assert.ok(names.some((d) => d.name === "b2-e2e-exp" && d.what === "expiring"))
  void due
  void exp
  console.log("ALL PASS")
} finally {
  const all = await keys(F).catch(() => [] as string[])
  if (all.length) await F.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: all.map((Key) => ({ Key: Key! })) } })).catch(() => {})
  await F.send(new DeleteBucketCommand({ Bucket: BUCKET })).catch((e) => console.log("bucket cleanup:", e.Code ?? e.message))
  await db.delete(s3Keys).where(inArray(s3Keys.id, made))
  process.exit(0)
}
