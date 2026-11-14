// Bytes arriving over WebDAV or the S3 API become a file or a new version, with
// the same rules as a web upload: size and type limits, quota, version pruning,
// Recent, edit notices, thumbnails and search. One place, so the two can't drift.
import "server-only"

import { createHash, randomBytes } from "node:crypto"

import { and, eq, ne, sql } from "drizzle-orm"
import { lookup } from "mime-types"

import { recordSaved } from "@/lib/activity"
import { db } from "@/lib/db"
import { fileVersions } from "@/lib/db/schema"
import { isJunk } from "@/lib/file-rules"
import { notifyEdit } from "@/lib/notify"
import { checkStorage, spaceLeft } from "@/lib/quota"
import { enqueue, enqueueDerive } from "@/lib/redis"
import { putObject, putStream, deleteKeys } from "@/lib/s3"
import { scannable } from "@/lib/secrets/leak-rules"
import {
  deleteUnreferenced,
  pruneVersions,
  rejectReason,
  saveUploaded,
  uploadLimits,
} from "@/lib/uploads"

export const mimeFor = (name: string) => lookup(name) || "application/octet-stream"

// `code` says what went wrong; `status` is the WebDAV answer.
export type StoreError = {
  status: 403 | 404 | 409 | 412 | 413 | 507
  code: "rejected" | "tooBig" | "full" | "conflict" | "check" | "precondition" | "noKey"
  message?: string
}

export type ObjectMeta = { contentType?: string; user?: Record<string, string>; headers?: Record<string, string> }

// S3 conditional writes, checked inside the save's transaction: `none` is
// If-None-Match: * (nothing may be there), `match` the ETags If-Match allows.
export type When = { none?: boolean; match?: string[] }

export type Stored = { nodeId: string; versionId: string; etag: string; created: boolean }

type Where = { ownerId: string; parentId: string | null }
type Existing = { currentVersionId: string | null } | null

// Counts bytes on the way to S3 and stops past `max`; hashes them too.
function capped(body: ReadableStream<Uint8Array>, max: number | null) {
  let seen = 0
  const over = { hit: false }
  const md5 = createHash("md5")
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        seen += chunk.byteLength
        if (max !== null && seen > max) {
          over.hit = true
          ctl.error(new Error("too big"))
        } else {
          md5.update(chunk)
          ctl.enqueue(chunk)
        }
      },
    })
  )
  return { stream, over, size: () => seen, md5: () => md5.digest("hex") }
}

// Stores bytes as a new file in the folder, or a new version of the file with
// that name. An empty current version (clients often create a file empty, then
// write it) is replaced rather than kept as history.
// `declared`: the size the client announced, null for a chunked upload (it is
// counted as it streams). `check` can refuse the finished object (a bad digest)
// by returning a message; the object is then dropped before it becomes a file.
export async function storeFile(o: {
  me: string
  at: Where
  name: string
  existing: Existing
  body: ReadableStream<Uint8Array> | null
  declared: number | null
  mime?: string
  prefix?: string
  meta?: ObjectMeta
  quiet?: boolean
  when?: When
  check?: (got: { md5: string; size: number }) => string | null
}): Promise<{ error: StoreError } | Stored> {
  const { at, name } = o
  const limits = await uploadLimits()
  const declared = o.declared ?? 0
  const why = rejectReason(name, declared, limits)
  if (why) {
    const tooBig = limits.maxUploadBytes !== null && declared > limits.maxUploadBytes
    return { error: { status: tooBig ? 413 : 403, code: tooBig ? "tooBig" : "rejected", message: why } }
  }
  const left = await spaceLeft(at.ownerId)
  if (left !== null && declared > left)
    return { error: { status: 507, code: "full", message: "Storage is full." } }

  const key = `${o.prefix ?? "dav"}-${randomBytes(16).toString("hex")}`
  const mime = o.mime ?? mimeFor(name)
  let size = 0
  let md5 = createHash("md5").digest("hex")
  if (o.body && o.declared !== 0) {
    const max = Math.min(left ?? Infinity, limits.maxUploadBytes ?? Infinity)
    const counted = capped(o.body, Number.isFinite(max) ? max : null)
    try {
      await putStream(key, counted.stream, mime)
    } catch (e) {
      if (counted.over.hit) {
        const full = left !== null && counted.size() > left
        return { error: { status: full ? 507 : 413, code: full ? "full" : "tooBig" } }
      }
      throw e
    }
    size = counted.size()
    md5 = counted.md5()
  } else await putObject(key, new Uint8Array(), mime)

  const bad = o.check?.({ md5, size })
  if (bad) {
    await deleteKeys([key])
    return { error: { status: 403, code: "check", message: bad } }
  }
  const saved = await saveVersion({ ...o, key, size, mime, etag: md5 })
  // The object is new, so nothing else points at it.
  if ("error" in saved) await deleteKeys([key])
  return saved
}

const failed = (message: string): StoreError => ({ status: 412, code: "precondition", message })

// If-None-Match / If-Match for a write. The live file's row is locked until the
// transaction ends, so a second writer waits and then sees what the first left.
// Nothing there yet has no row to lock, so same-name writers queue on an
// advisory lock instead.
async function checkWhen(tx: Pick<typeof db, "execute">, at: Where, name: string, w: When) {
  const place = `${at.ownerId}/${at.parentId ?? ""}/${name.toLowerCase()}`
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${place}, 0))`)
  const [row] = await tx.execute<{ etag: string | null; id: string }>(sql`
    select v.etag, v.id from nodes n join file_versions v on v.id = n.current_version_id
    where n.owner_id = ${at.ownerId} and n.parent_id is not distinct from ${at.parentId}
      and lower(n.name) = lower(${name}) and n.trashed_at is null and n.kind = 'file' for update of n`)
  if (w.none && row) return failed("At least one of the pre-conditions you specified did not hold.")
  if (w.match) {
    if (!row) return { status: 404, code: "noKey", message: "The specified key does not exist." } as StoreError
    const tag = row.etag ?? row.id.replace(/-/g, "")
    if (!w.match.includes("*") && !w.match.includes(tag)) return failed("At least one of the pre-conditions you specified did not hold.")
  }
  return null
}

// The object at `key` (already in the bucket) becomes the file's newest version.
export async function saveVersion(o: {
  me: string
  at: Where
  name: string
  existing: Existing
  key: string
  size: number
  mime: string
  etag: string | null
  meta?: ObjectMeta
  quiet?: boolean
  when?: When
}): Promise<{ error: StoreError } | Stored> {
  const { at, name, key, size, mime } = o
  const before = o.existing?.currentVersionId
    ? (
        await db
          .select({ id: fileVersions.id, size: fileVersions.size, key: fileVersions.s3Key, keep: fileVersions.keep })
          .from(fileVersions)
          .where(eq(fileVersions.id, o.existing.currentVersionId))
      )[0]
    : undefined
  const saved = await db.transaction(async (tx) => {
    if (o.when) {
      const bad = await checkWhen(tx, at, name, o.when)
      if (bad) return { error: bad.message, bad }
    }
    return saveUploaded(tx, {
      ownerId: at.ownerId,
      parentId: at.parentId,
      name,
      version: { s3Key: key, size, mime, uploadedBy: o.me, etag: o.etag, meta: o.meta ?? null },
      onConflict: "version",
    })
  })
  if ("bad" in saved) return { error: saved.bad }
  if (saved.error || !saved.nodeId)
    return { error: { status: 409, code: "conflict", message: saved.error } }
  if (before && before.size === 0 && !before.keep) {
    await db.delete(fileVersions).where(eq(fileVersions.id, before.id))
    await deleteUnreferenced([before.key])
  }
  if (isJunk(name)) {
    // Temporary save files keep no history and tell nobody.
    const old = await db
      .delete(fileVersions)
      .where(and(eq(fileVersions.nodeId, saved.nodeId), ne(fileVersions.id, saved.versionId!)))
      .returning({ key: fileVersions.s3Key })
    await deleteUnreferenced(old.map((r) => r.key))
  } else {
    await pruneVersions(saved.nodeId)
    if (!o.quiet) {
      await recordSaved(saved.nodeId, saved.versionId!, o.me)
      if (at.ownerId !== o.me) await notifyEdit(o.me, saved.nodeId)
      await enqueueDerive(saved.versionId!)
      // The worker checks text and code files for leaked keys (if an admin left that on).
      if (scannable(name, mime, size)) await enqueue("leak-scan", { nodeId: saved.nodeId }).catch(() => {})
    }
  }
  await checkStorage(at.ownerId)
  return { nodeId: saved.nodeId, versionId: saved.versionId!, etag: o.etag ?? "", created: !o.existing }
}
