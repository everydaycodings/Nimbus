// Where a job's archives go: a bucket on this server's S3 API (a bucket and a key scoped to it are made for
// the job) or any S3 the member types in (must pass a write/read/delete test before it is saved).
import "server-only"

import { and, eq } from "drizzle-orm"

import { client, testDest, type Dest } from "@/lib/backup/dest"
import { encrypt } from "@/lib/crypto"
import { db } from "@/lib/db"
import { gitBackupJobs, nodes, s3Buckets, s3Keys } from "@/lib/db/schema"
import { createBucketFolder, createKey, listBuckets, revokeKey, s3State, type S3State } from "@/lib/s3api/manage"
import { REGION, endpoint } from "@/lib/s3api/rules"
import { checkUrl, dialable } from "@/lib/secrets/webhooks"
import { deleteNodes } from "@/lib/uploads"

// The destination columns of gitBackupJobs.
export type DestFields = Pick<
  typeof gitBackupJobs.$inferInsert,
  "destKind" | "bucketId" | "keyId" | "s3Endpoint" | "s3Region" | "s3Bucket" | "s3AccessKey" | "s3SecretEnc" | "s3PathStyle"
>

export type DestInput =
  | { kind: "nimbus"; bucketId?: string; newBucket?: string }
  | { kind: "s3"; endpoint: string; region: string; bucket: string; accessKey: string; secret: string; pathStyle: boolean }

// What the wizard offers for Nimbus S3: why it can't be used, or the member's buckets they can write to.
export async function nimbusOptions(userId: string): Promise<{ state: S3State; buckets: { id: string; name: string }[] }> {
  const state = await s3State(userId)
  if (state !== "ready") return { state, buckets: [] }
  const rows = await listBuckets(userId)
  return { state, buckets: rows.filter((b) => !b.gone && b.role !== "viewer").map((b) => ({ id: b.id, name: b.name })) }
}

// Proves the keys work: the bucket answers, then a probe object goes in and out.
export async function testS3(v: Extract<DestInput, { kind: "s3" }>): Promise<{ error?: string }> {
  const bucket = v.bucket.trim()
  const accessKey = v.accessKey.trim()
  if (!v.endpoint.trim() || !bucket || !accessKey || !v.secret) return { error: "Fill in the endpoint, bucket, access key and secret." }
  const d: Dest = { provider: "other", endpoint: null, region: v.region.trim() || "us-east-1", bucket, folder: "", pathStyle: v.pathStyle, accessKey, secretKey: v.secret, fromEnv: false }
  try {
    const u = checkUrl(v.endpoint.trim())
    await dialable(u)
    d.endpoint = u.toString().replace(/\/+$/, "")
    await testDest(d)
    return {}
  } catch (e) {
    const err = e as Error & { name?: string; $metadata?: { httpStatusCode?: number } }
    const code = err.$metadata?.httpStatusCode
    if (code === 403) return { error: "The storage refused these keys. Check the access key, secret and that they may write to this bucket." }
    if (code === 404 || err.name === "NotFound" || err.name === "NoSuchBucket") return { error: "That bucket isn't there." }
    return { error: err.message || "Couldn't reach that storage." }
  } finally {
    client(d).destroy()
  }
}

// Turns what the member chose into the job's destination columns (making the bucket and scoped key, or testing the S3).
// label: the tool the access key is named after.
export async function prepareDest(userId: string, jobName: string, v: DestInput, label = "Git Backup"): Promise<{ fields: DestFields } | { error: string }> {
  if (v.kind === "s3") {
    const t = await testS3(v)
    if (t.error) return { error: t.error }
    return {
      fields: {
        destKind: "s3",
        bucketId: null,
        keyId: null,
        s3Endpoint: checkUrl(v.endpoint.trim()).toString().replace(/\/+$/, ""),
        s3Region: v.region.trim() || "us-east-1",
        s3Bucket: v.bucket.trim(),
        s3AccessKey: v.accessKey.trim(),
        s3SecretEnc: encrypt(v.secret),
        s3PathStyle: v.pathStyle,
      },
    }
  }
  if ((await s3State(userId)) !== "ready") return { error: "S3 isn't available on this server or for your account. Use Another S3 instead." }
  const url = endpoint()!
  let name: string
  if (v.newBucket) {
    name = v.newBucket.trim()
    const made = await createBucketFolder(userId, name, true)
    if (made.error) return { error: made.error }
  } else {
    if (!/^[0-9a-f-]{36}$/i.test(String(v.bucketId))) return { error: "That bucket isn't here. Pick another." }
    const [b] = await db.select({ name: s3Buckets.name }).from(s3Buckets).where(and(eq(s3Buckets.id, String(v.bucketId)), eq(s3Buckets.userId, userId)))
    if (!b) return { error: "That bucket isn't here. Pick another." }
    name = b.name
  }
  const [bucket] = await db.select({ id: s3Buckets.id, nodeId: s3Buckets.nodeId }).from(s3Buckets).where(and(eq(s3Buckets.userId, userId), eq(s3Buckets.name, name)))
  if (!bucket) return { error: "Couldn't find the bucket." }
  const key = await createKey(userId, {
    name: `${label} — ${jobName}`.slice(0, 60),
    perms: ["list", "read", "write", "delete"],
    allBuckets: false,
    bucketIds: [bucket.id],
    expiry: "never",
    prefix: "",
    allowedIps: [],
    rotateEveryDays: null,
  })
  if (key.error || !key.accessKeyId || !key.secret) {
    // The bucket made a moment ago is still empty: take it (and its folder) away again.
    if (v.newBucket) await deleteNodes(eq(nodes.id, bucket.nodeId)).catch(() => {})
    return { error: key.error ?? "Couldn't make the access key." }
  }
  const [row] = await db.select({ id: s3Keys.id }).from(s3Keys).where(and(eq(s3Keys.userId, userId), eq(s3Keys.accessKeyId, key.accessKeyId)))
  return {
    fields: { destKind: "nimbus", bucketId: bucket.id, keyId: row?.id ?? null, s3Endpoint: url, s3Region: REGION, s3Bucket: name, s3AccessKey: key.accessKeyId, s3SecretEnc: encrypt(key.secret), s3PathStyle: true },
  }
}

// On job delete or a destination change: the key made for the job goes away.
export const releaseKey = async (userId: string, keyId: string | null) => {
  if (keyId) await revokeKey(userId, keyId)
}
