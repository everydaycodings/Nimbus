// The S3 route's hot path for metrics: one Redis pipeline per request, never awaited by the
// caller and never throwing (Redis being down must not break S3). The worker's s3-usage-flush
// (lib/s3api/usage.ts) moves the counters into Postgres.
import "server-only"

import { redis } from "@/lib/redis"

import { activityEvent, agentFamily, classify, counterKey, hourOf } from "./record-rules.ts"

export const ACTIVITY_LIST = "s3:act"
const ACTIVITY_CAP = 100_000
// A counter hash the worker never collected (it was down) goes away after this.
const COUNTER_TTL = 2 * 24 * 3600

export type Seen = {
  bucketId: string
  keyId: string
  method: string
  // The decoded object key; null for bucket-level requests.
  objectKey: string | null
  q: URLSearchParams
  // The request carries x-amz-copy-source.
  copy: boolean
  status: number
  bytesIn: number
  bytesOut: number
  agent: string | null
  ip: string | null
}

export function record(s: Seen) {
  const { cls, op, logged } = classify(s.method, s.objectKey !== null, s.q, s.copy)
  const family = agentFamily(s.agent)
  const at = new Date()
  const k = counterKey(hourOf(at), s.bucketId, s.keyId)
  const p = redis.pipeline()
  p.hincrby(k, cls, 1)
  if (s.bytesIn) p.hincrby(k, "bi", s.bytesIn)
  if (s.bytesOut) p.hincrby(k, "bo", s.bytesOut)
  if (s.status >= 500) p.hincrby(k, "e5", 1)
  else if (s.status >= 400) p.hincrby(k, "e4", 1)
  p.hincrby(k, `a:${family}`, 1)
  if (s.ip) p.hincrby(k, `i:${s.ip}`, 1)
  p.expire(k, COUNTER_TTL)
  if (logged || s.status >= 400) {
    p.lpush(ACTIVITY_LIST, JSON.stringify(activityEvent(s, op, family, at)))
    p.ltrim(ACTIVITY_LIST, 0, ACTIVITY_CAP - 1)
  }
  p.exec().catch(() => {})
}
