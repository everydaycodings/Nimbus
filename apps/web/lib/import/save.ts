// Brings one file's bytes into Files: streams them to the bucket (counting, hashing, and stopping at the quota or upload limit), then
// makes the file. A name already taken keeps both ("name (2).ext"); nothing existing is replaced or deleted.
import "server-only"

import { createHash, randomBytes } from "node:crypto"
import { Readable, Transform } from "node:stream"

import { eq } from "drizzle-orm"

import { recordSaved } from "@/lib/activity"
import { db } from "@/lib/db"
import { nodes } from "@/lib/db/schema"
import { spaceLeft } from "@/lib/quota"
import { enqueueDerive } from "@/lib/redis"
import { deleteKeys, putObject, putStream } from "@/lib/s3"
import { mimeFor } from "@/lib/store-file"
import { pruneVersions, rejectReason, saveUploaded, uploadLimits } from "@/lib/uploads"

export type Saved = { nodeId: string; name: string; size: number } | { error: string }

// declared: the size the source announced, null when it doesn't know (a Google Doc is made on export).
// mtime: kept as the file's date (and its photo date when `taken`); null leaves the import time.
export async function saveImported(o: { userId: string; parentId: string | null; name: string; stream: Readable; declared: number | null; mtime: Date | null; taken?: boolean }): Promise<Saved> {
  const name = o.name.replace(/[\u0000-\u001f]/g, "_").trim().slice(0, 255) || "unnamed"
  const limits = await uploadLimits()
  const why = rejectReason(name, o.declared ?? 0, limits)
  if (why) return { error: why }
  const left = await spaceLeft(o.userId)
  if (left !== null && (o.declared ?? 0) > left) return { error: "Storage is full." }
  const max = Math.min(left ?? Infinity, limits.maxUploadBytes ?? Infinity)

  const key = `import-${randomBytes(16).toString("hex")}`
  const sha = createHash("sha256")
  const md5 = createHash("md5")
  let size = 0
  let over = false
  const tap = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length
      if (size > max) {
        over = true
        return done(new Error("too big"))
      }
      sha.update(chunk)
      md5.update(chunk)
      done(null, chunk)
    },
  })
  o.stream.on("error", (e) => tap.destroy(e))
  try {
    // An empty file has nothing to stream (the multipart upload wants at least one byte).
    if (o.declared === 0) {
      o.stream.destroy()
      await putObject(key, new Uint8Array(), mimeFor(name))
    } else await putStream(key, Readable.toWeb(o.stream.pipe(tap)) as ReadableStream<Uint8Array>, mimeFor(name))
  } catch (e) {
    await deleteKeys([key]).catch(() => {})
    if (over) return { error: left !== null && size > left ? "Storage is full." : "Larger than the upload limit." }
    return { error: (e as Error).message || "The download failed." }
  }
  if (o.declared !== null && o.declared >= 0 && size !== o.declared) {
    await deleteKeys([key]).catch(() => {})
    return { error: `The download was cut short (${size} of ${o.declared} bytes).` }
  }
  const saved = await db.transaction((tx) =>
    saveUploaded(tx, {
      ownerId: o.userId,
      parentId: o.parentId,
      name,
      version: { s3Key: key, size, mime: mimeFor(name), uploadedBy: o.userId, sha256: sha.digest("hex"), etag: md5.digest("hex"), ...(o.mtime && { createdAt: o.mtime, ...(o.taken && { takenAt: o.mtime }) }) },
      onConflict: "keep",
    })
  )
  if (!saved.nodeId) {
    await deleteKeys([key]).catch(() => {})
    return { error: saved.error ?? "Couldn't save the file." }
  }
  if (o.mtime) await db.update(nodes).set({ createdAt: o.mtime, updatedAt: o.mtime }).where(eq(nodes.id, saved.nodeId))
  const [n] = await db.select({ name: nodes.name }).from(nodes).where(eq(nodes.id, saved.nodeId))
  await recordSaved(saved.nodeId, saved.versionId!, o.userId, "imported")
  await pruneVersions(saved.nodeId)
  await enqueueDerive(saved.versionId!)
  return { nodeId: saved.nodeId, name: n.name, size }
}
