// Pure helpers for record.ts: what a request counts as, who sent it, and the Redis key names.
export type Cls = "r" | "w" | "l" | "d"

// `op` names the operation in the activity log; `logged` is true for the writes the log keeps
// (failures are always kept). Multipart parts and starts are counted but not logged.
export function classify(method: string, hasKey: boolean, q: URLSearchParams, copy = false): { cls: Cls; op: string; logged: boolean } {
  const upload = q.has("uploadId")
  switch (method) {
    case "GET":
      return !hasKey || upload ? { cls: "l", op: "LIST", logged: false } : { cls: "r", op: "GET", logged: false }
    case "HEAD":
      return { cls: "r", op: "HEAD", logged: false }
    case "PUT":
      if (upload) return { cls: "w", op: "PART", logged: false }
      return { cls: "w", op: copy ? "COPY" : "PUT", logged: true }
    case "DELETE":
      return { cls: "d", op: "DELETE", logged: !upload }
    case "POST":
      if (q.has("delete")) return { cls: "d", op: "DELETE_MANY", logged: true }
      if (upload) return { cls: "w", op: "MULTIPART_COMPLETE", logged: true }
      return { cls: "w", op: "MULTIPART_START", logged: false }
    default:
      return { cls: "r", op: method, logged: false }
  }
}

const AGENTS: [RegExp, string][] = [
  [/aws-cli/i, "aws-cli"],
  [/boto3|botocore/i, "boto3"],
  [/aws-sdk-js|aws-sdk-nodejs/i, "aws-sdk-js"],
  [/rclone/i, "rclone"],
  [/restic/i, "restic"],
  [/minio|\bmc\b/i, "mc"],
  [/terraform/i, "terraform"],
  [/s3fs/i, "s3fs"],
  [/curl/i, "curl"],
]

export function agentFamily(ua: string | null | undefined) {
  return (ua && AGENTS.find(([re]) => re.test(ua))?.[1]) || "other"
}

// "2026-11-19T14": the UTC hour a counter belongs to.
export const hourOf = (d: Date) => d.toISOString().slice(0, 13)
// keyId null is a request through a bucket's public link.
export const counterKey = (hour: string, bucketId: string, keyId: string | null) => `s3:u:${hour}:${bucketId}:${keyId ?? "public"}`
export const parseCounterKey = (k: string) => {
  const [, , hour, bucketId, keyId] = k.split(":")
  return { hour, bucketId, keyId: keyId === "public" ? null : keyId }
}

export type ActivityEvent = { b: string; k: string | null; at: string; op: string; o: string | null; s: number; n: number; ip: string | null; ua: string }

// n: the object bytes that moved (sent for writes, returned otherwise); 0 where the body is
// only an XML list (multipart complete, multi-delete).
export function activityEvent(
  s: { bucketId: string; keyId: string | null; objectKey: string | null; status: number; bytesIn: number; bytesOut: number; ip: string | null },
  op: string,
  family: string,
  at: Date
): ActivityEvent {
  return { b: s.bucketId, k: s.keyId, at: at.toISOString(), op, o: s.objectKey, s: s.status, n: op === "MULTIPART_COMPLETE" || op === "DELETE_MANY" ? 0 : s.bytesIn || s.bytesOut, ip: s.ip, ua: family }
}

// "::ffff:203.0.113.5" (IPv4 over an IPv6 socket) → "203.0.113.5".
export const plainIp = (ip: string | null) => (ip?.startsWith("::ffff:") && ip.includes(".") ? ip.slice(7) : ip)
