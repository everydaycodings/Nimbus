"use server"

import { revalidatePath } from "next/cache"

import { saveTokenToSecret } from "@/lib/registry/secrets-pull"
import { requireMember } from "@/lib/session"
import * as svc from "@/lib/s3api/manage"
import { activity, usage, type ActivityFilter } from "@/lib/s3api/stats"

const NOT_ON = { error: "S3 isn't available for your account right now." }

async function member() {
  const me = await requireMember()
  return (await svc.s3State(me.id)) === "ready" ? me : null
}

const done = <T extends { error?: string }>(r: T) => {
  if (!r.error) revalidatePath("/", "layout")
  return r
}

export async function createKey(o: svc.NewKey): ReturnType<typeof svc.createKey> {
  const me = await member()
  return me ? done(await svc.createKey(me.id, o)) : NOT_ON
}

export async function updateKey(id: string, o: svc.NewKey) {
  const me = await member()
  return me ? done(await svc.updateKey(me.id, id, o)) : NOT_ON
}

export async function rotateKey(id: string, graceSeconds: number): ReturnType<typeof svc.rotateKey> {
  const me = await member()
  return me ? done(await svc.rotateKey(me.id, id, graceSeconds)) : NOT_ON
}

export async function setKeyDisabled(id: string, disabled: boolean) {
  const me = await requireMember()
  return done(await svc.setKeyDisabled(me.id, id, disabled))
}

// "Save to Secrets" on the key reveal: the secret and the key ID as secrets.
export async function saveS3KeyToSecret(o: Parameters<typeof saveTokenToSecret>[1]) {
  const me = await member()
  return me ? saveTokenToSecret(me.id, o) : { ...NOT_ON, locked: false, requested: false }
}

export async function revokeKey(id: string) {
  const me = await requireMember()
  return done(await svc.revokeKey(me.id, id))
}

// An existing folder (own or shared with them) becomes a bucket.
export async function markBucket(nodeId: string, name: string, quiet: boolean) {
  const me = await member()
  return me ? done(await svc.markBucket(me.id, nodeId, name, quiet)) : NOT_ON
}

export async function createBucketFolder(name: string, quiet: boolean) {
  const me = await member()
  return me ? done(await svc.createBucketFolder(me.id, name, quiet)) : NOT_ON
}

export async function unmarkBucket(id: string) {
  const me = await requireMember()
  return done(await svc.unmarkBucket(me.id, id))
}

export async function setQuiet(id: string, quiet: boolean) {
  const me = await requireMember()
  return done(await svc.setQuiet(me.id, id, quiet))
}

// For the Details panel.
export async function getBucket(nodeId: string) {
  const me = await requireMember()
  return svc.bucketOf(me.id, nodeId)
}

// For the "Use as S3 bucket" dialog: names already taken, so it can say so as you type.
export async function myBucketNames() {
  const me = await requireMember()
  return (await svc.listBuckets(me.id)).map((b) => b.name)
}

export async function renameBucket(id: string, name: string) {
  const me = await member()
  return me ? done(await svc.renameBucket(me.id, id, name)) : NOT_ON
}

// The object browser's "Load more".
export async function moreObjects(bucketId: string, prefix: string, cursor: string) {
  const me = await member()
  return me ? svc.listObjects(me.id, bucketId, prefix, cursor) : null
}

export async function presignObject(bucketId: string, key: string, seconds: number) {
  const me = await member()
  return me ? svc.presign(me.id, bucketId, key, seconds) : NOT_ON
}

// Activity filters and "Load more". The scope is always the signed-in member's own.
export async function moreActivity(filter: ActivityFilter, cursor?: string) {
  const me = await member()
  if (!me) return null
  try {
    return await activity({ userId: me.id }, filter, cursor)
  } catch {
    return null
  }
}

// The key panel: a week of requests and the last ten calls for one key.
export async function keyUsage(keyId: string) {
  const me = await member()
  if (!me) return null
  const scope = { userId: me.id, keyId }
  try {
    const [points, recent] = await Promise.all([usage(scope, "7d"), activity(scope, {}, undefined, 10)])
    return { points, rows: recent.rows }
  } catch {
    return null
  }
}
