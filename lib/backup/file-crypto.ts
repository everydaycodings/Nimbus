// Backups are encrypted before they leave the machine, so a leaked bucket
// reveals nothing. AES-256-GCM, streamed:
//
//   "NBK1" | iv (12 bytes) | ciphertext | auth tag (16 bytes)
//
// The key is BACKUP_ENCRYPTION_KEY (32 bytes, base64). Lose it and every
// encrypted backup is unreadable: keep a copy offline.
// Relative imports only: scripts/backup-worker.ts runs this under plain node.
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type DecipherGCM,
} from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { rename, rm } from "node:fs/promises"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

const MAGIC = Buffer.from("NBK1")
const IV = 12
const TAG = 16
const HEADER = MAGIC.length + IV

// The key from env, or null when it isn't set.
export function backupKey() {
  const raw = process.env.BACKUP_ENCRYPTION_KEY
  if (!raw) return null
  const key = Buffer.from(raw, "base64")
  if (key.length !== 32)
    throw new Error("BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded.")
  return key
}

export function requireKey() {
  const key = backupKey()
  if (!key)
    throw new Error(
      "BACKUP_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32"
    )
  return key
}

// Encrypts what passes through into the format above.
export function encryptStream(key: Buffer) {
  const iv = randomBytes(IV)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  let started = false
  const head = (t: Transform) => {
    if (!started) t.push(Buffer.concat([MAGIC, iv]))
    started = true
  }
  return new Transform({
    transform(chunk: Buffer, _, done) {
      head(this)
      done(null, cipher.update(chunk))
    },
    flush(done) {
      head(this)
      this.push(cipher.final())
      done(null, cipher.getAuthTag())
    },
  })
}

// Decrypts a stream in the format above. It errors at the end when the data
// was changed, truncated or sealed under another key, so whatever it wrote
// must not be trusted until it finishes.
export function decryptStream(key: Buffer) {
  let head = Buffer.alloc(0)
  let decipher: DecipherGCM | null = null
  // The last TAG bytes seen so far: the tag, if the stream ends here.
  let tail = Buffer.alloc(0)
  return new Transform({
    transform(chunk: Buffer, _, done) {
      if (!decipher) {
        head = Buffer.concat([head, chunk])
        if (head.length < HEADER) return done()
        if (!head.subarray(0, MAGIC.length).equals(MAGIC))
          return done(new Error("Not a Nimbus backup file."))
        decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          head.subarray(MAGIC.length, HEADER),
          { authTagLength: TAG }
        )
        chunk = head.subarray(HEADER)
      }
      const all = Buffer.concat([tail, chunk])
      tail = all.subarray(Math.max(0, all.length - TAG))
      done(null, decipher.update(all.subarray(0, all.length - tail.length)))
    },
    flush(done) {
      if (!decipher || tail.length < TAG)
        return done(new Error("Backup file is too short."))
      decipher.setAuthTag(tail)
      try {
        done(null, decipher.final())
      } catch {
        done(
          new Error(
            "Backup file failed its integrity check: it was changed, truncated, or encrypted with another key."
          )
        )
      }
    },
  })
}

// Decrypts `input` to `output`. The plaintext takes its name only once the
// tag checks out, so a tampered file never leaves data a restore would read.
export async function decryptFile(input: string, output: string, key: Buffer) {
  const partial = `${output}.partial`
  try {
    await pipeline(
      createReadStream(input),
      decryptStream(key),
      createWriteStream(partial)
    )
  } catch (e) {
    await rm(partial, { force: true })
    throw e
  }
  await rename(partial, output)
}
