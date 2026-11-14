"use server"

import { revalidatePath } from "next/cache"

import { requireMember } from "@/lib/session"
import * as svc from "@/lib/s3api/manage"

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
