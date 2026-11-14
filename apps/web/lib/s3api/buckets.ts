// Bucket operations. A bucket is a folder its member marked (Use as S3
// bucket); CreateBucket makes one under "S3 buckets" at the member's root.
import "server-only"

import { and, eq, isNull } from "drizzle-orm"

import { db } from "@/lib/db"
import { nodes, s3Buckets, s3KeyBuckets, user } from "@/lib/db/schema"
import { trashAs } from "@/lib/tree-ops"
import { isClash, mkdirp } from "@/lib/uploads"

import { enqueueBucketEtags } from "./etags.ts"
import { respond, xml, type C } from "./http.ts"
import { abortUploads } from "./multipart.ts"
import { BUCKETS_FOLDER, REGION, bucketNameError } from "./rules.ts"
import { bucketFor, mustWrite, reachable } from "./resolve.ts"
import { isoDate, tag, S3Error } from "./xml.ts"

export async function listBuckets(c: C) {
  const [me] = await db.select({ name: user.name }).from(user).where(eq(user.id, c.who.userId))
  const rows = await reachable(c.who)
  return xml(
    c,
    "ListAllMyBucketsResult",
    `<Owner>${tag("ID", c.who.userId)}${tag("DisplayName", me?.name ?? c.who.userId)}</Owner><Buckets>${rows
      .map((r) => `<Bucket>${tag("Name", r.name)}${tag("CreationDate", isoDate(r.createdAt))}</Bucket>`)
      .join("")}</Buckets>`
  )
}

export async function createBucket(c: C, name: string) {
  if (!c.who.write) throw new S3Error("AccessDenied", "This access key can't create buckets.")
  const bad = bucketNameError(name)
  if (bad) throw new S3Error("InvalidBucketName", bad, 400)
  const [mine] = await db
    .select({ id: s3Buckets.id })
    .from(s3Buckets)
    .where(and(eq(s3Buckets.userId, c.who.userId), eq(s3Buckets.name, name)))
  if (mine) throw new S3Error("BucketAlreadyOwnedByYou", "Your previous request to create the named bucket succeeded and you already own it.", 409)
  let nodeId: string
  try {
    nodeId = await db.transaction(async (tx) => {
      // An existing folder of that name under "S3 buckets" is adopted.
      const made = await mkdirp(tx, c.who.userId, null, [BUCKETS_FOLDER, name])
      if ("error" in made) throw new S3Error("BucketAlreadyExists", made.error, 409)
      const [row] = await tx
        .insert(s3Buckets)
        .values({ userId: c.who.userId, nodeId: made.id!, name, quiet: true })
        .returning({ id: s3Buckets.id })
      // A key limited to a list of buckets gets the one it made.
      if (!c.who.all) await tx.insert(s3KeyBuckets).values({ keyId: c.who.keyId, bucketId: row.id })
      return made.id!
    })
  } catch (e) {
    if (isClash(e)) throw new S3Error("BucketAlreadyExists", "That folder is already a bucket.", 409)
    throw e
  }
  await enqueueBucketEtags(nodeId)
  return respond(c, 200, null, { Location: `/${name}` })
}

export async function deleteBucket(c: C, name: string) {
  const b = await bucketFor(c.who, name)
  mustWrite(b)
  if (b.role !== "owner") throw new S3Error("AccessDenied", "Only the folder's owner can delete a bucket.")
  const [kid] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(and(eq(nodes.parentId, b.nodeId), isNull(nodes.trashedAt)))
    .limit(1)
  if (kid) throw new S3Error("BucketNotEmpty", "The bucket you tried to delete is not empty.", 409)
  await abortUploads(b.id)
  await db.delete(s3Buckets).where(eq(s3Buckets.id, b.id))
  const r = await trashAs(c.who.userId, [b.nodeId])
  if (r.error) throw new S3Error("AccessDenied", r.error)
  return respond(c, 204)
}

export async function headBucket(c: C, name: string) {
  await bucketFor(c.who, name)
  return respond(c, 200, null, { "x-amz-bucket-region": REGION })
}

export async function location(c: C, name: string) {
  await bucketFor(c.who, name)
  // us-east-1 is the empty constraint.
  return xml(c, "LocationConstraint", "")
}

export async function versioning(c: C, name: string) {
  await bucketFor(c.who, name)
  return xml(c, "VersioningConfiguration", tag("Status", "Enabled"))
}

// Versioning is always on: asking for it is fine, suspending it isn't.
export async function putVersioning(c: C, name: string, body: string) {
  await bucketFor(c.who, name)
  if (/<Status>\s*Suspended\s*<\/Status>/.test(body))
    throw new S3Error("NotImplemented", "Versioning can't be suspended: Nimbus keeps every version.", 501)
  return respond(c, 200)
}
