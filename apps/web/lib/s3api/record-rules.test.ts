import assert from "node:assert/strict"
import { test } from "node:test"

import { activityEvent, agentFamily, classify, counterKey, hourOf, parseCounterKey, plainIp } from "./record-rules.ts"

test("agentFamily", () => {
  const cases: [string | null, string][] = [
    ["aws-cli/2.15.0 Python/3.11 md/awscrt", "aws-cli"],
    ["Boto3/1.34 md/Botocore#1.34 ua/2.0", "boto3"],
    ["aws-sdk-js/3.500.0 ua/2.0 os/linux", "aws-sdk-js"],
    ["rclone/v1.66.0", "rclone"],
    ["restic/0.16.4", "restic"],
    ["MinIO (linux; amd64) minio-go/v7 mc/RELEASE.2024", "mc"],
    ["APN/1.0 HashiCorp/1.0 Terraform/1.7.5 (+https://www.terraform.io)", "terraform"],
    ["s3fs/1.93 (commit hash unknown; OpenSSL)", "s3fs"],
    ["curl/8.5.0", "curl"],
    ["Mozilla/5.0", "other"],
    [null, "other"],
  ]
  for (const [ua, want] of cases) assert.equal(agentFamily(ua), want, String(ua))
})

test("classify", () => {
  const q = (s = "") => new URLSearchParams(s)
  assert.deepEqual(classify("GET", false, q("list-type=2")), { cls: "l", op: "LIST", logged: false })
  assert.deepEqual(classify("GET", true, q()), { cls: "r", op: "GET", logged: false })
  assert.equal(classify("GET", true, q("uploadId=x")).cls, "l")
  assert.deepEqual(classify("PUT", true, q()), { cls: "w", op: "PUT", logged: true })
  assert.equal(classify("PUT", true, q(), true).op, "COPY")
  assert.deepEqual(classify("PUT", true, q("uploadId=x&partNumber=1")), { cls: "w", op: "PART", logged: false })
  assert.deepEqual(classify("DELETE", true, q()), { cls: "d", op: "DELETE", logged: true })
  assert.deepEqual(classify("POST", false, q("delete")), { cls: "d", op: "DELETE_MANY", logged: true })
  assert.equal(classify("POST", true, q("uploadId=x")).op, "MULTIPART_COMPLETE")
  assert.equal(classify("POST", true, q("uploads")).logged, false)
  assert.equal(classify("HEAD", true, q()).cls, "r")
})

test("counter keys round-trip", () => {
  const h = hourOf(new Date("2026-11-19T14:35:10Z"))
  assert.equal(h, "2026-11-19T14")
  const k = counterKey(h, "b-1", "k-1")
  assert.deepEqual(parseCounterKey(k), { hour: h, bucketId: "b-1", keyId: "k-1" })
  assert.equal(parseCounterKey(counterKey(h, "b-1", null)).keyId, null)
})

test("activityEvent uses bytes in for writes, out otherwise", () => {
  const s = { bucketId: "b", keyId: "k", objectKey: "a/b", status: 200, ip: null }
  assert.equal(activityEvent({ ...s, bytesIn: 10, bytesOut: 0 }, "PUT", "curl", new Date(0)).n, 10)
  assert.equal(activityEvent({ ...s, bytesIn: 0, bytesOut: 7 }, "GET", "curl", new Date(0)).n, 7)
})

test("plainIp unwraps IPv4-mapped addresses only", () => {
  assert.equal(plainIp("::ffff:127.0.0.1"), "127.0.0.1")
  assert.equal(plainIp("::1"), "::1")
  assert.equal(plainIp(null), null)
})
