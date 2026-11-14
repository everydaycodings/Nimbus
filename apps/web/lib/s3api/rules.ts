// Pure S3 API rules shared by the protocol (lib/s3api) and the web pages.
// Relative-import safe, so node --test can load it.
import { randomBytes, randomInt } from "node:crypto"

export const REGION = "us-east-1"
export const KEY_PREFIX = "NMS3"
// Where CreateBucket puts new bucket folders, at the member's root.
export const BUCKETS_FOLDER = "S3 buckets"
export const MAX_KEYS_PER_MEMBER = 50
export const EXPIRY_DAYS = [30, 90, 365] as const
export const STALE_MULTIPART_DAYS = 7

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

// AWS-shaped: a 20-character id and a 40-character secret.
export function newKeyPair() {
  let id = KEY_PREFIX
  while (id.length < 20) id += UPPER[randomInt(UPPER.length)]
  const secret = randomBytes(30).toString("base64").replace(/\+/g, "A").replace(/\//g, "B")
  return { accessKeyId: id, secret }
}

// S3's bucket naming rules (the virtual-host-safe set): 3–63 characters of
// lowercase letters, digits, dots and hyphens, starting and ending with a
// letter or digit, no "..", and not shaped like an IP address.
export function bucketNameError(name: string): string | null {
  if (name.length < 3 || name.length > 63) return "Bucket names are 3 to 63 characters."
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name))
    return "Use lowercase letters, numbers, dots and hyphens, starting and ending with a letter or number."
  if (name.includes("..")) return "Bucket names can't have two dots in a row."
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return "Bucket names can't look like an IP address."
  if (name.startsWith("xn--") || name.endsWith("-s3alias")) return "That bucket name is reserved."
  return null
}

// A folder name made into a bucket name suggestion: "My Backups" → "my-backups".
export function suggestBucketName(folder: string) {
  const s = folder
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 63)
    .replace(/[.-]+$/, "")
  return s.length >= 3 ? s : `${s || "bucket"}-files`.slice(0, 63)
}

// The endpoint clients use, or null when setup didn't turn the S3 API on.
export function endpoint(env: Record<string, string | undefined> = process.env) {
  const d = env.S3API_DOMAIN?.trim()
  if (!d) return null
  return /^https?:\/\//.test(d) ? d.replace(/\/+$/, "") : `https://${d}`
}
