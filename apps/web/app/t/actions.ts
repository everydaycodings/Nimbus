"use server"

import { db } from "@/lib/db"
import { formatBytes } from "@/lib/file-rules"
import { checkStorage, spaceLeft } from "@/lib/quota"
import { enqueueDerive } from "@/lib/redis"
import { copyObject, deleteKeys, presignGet, thumbKey } from "@/lib/s3"
import { newKey } from "@/lib/services/transfers"
import { getSession } from "@/lib/session"
import {
  filesOf,
  findTransfer,
  logEvent,
  openTransfer,
  unlock,
} from "@/lib/transfer-links"
import { mkdirp, saveUploaded } from "@/lib/uploads"

// Anyone with the link can call these, so each one checks the transfer itself.

export async function unlockTransfer(
  token: string,
  password: string
): Promise<{ error?: string }> {
  const t = await findTransfer(String(token))
  if (!t) return { error: "This link doesn't work any more." }
  return unlock(t, String(password ?? ""))
}

export async function transferPreviewUrl(token: string, id: string) {
  const t = await openTransfer(String(token))
  if (!t) return null
  const [file] = (await filesOf(t.id)).filter((f) => f.id === String(id))
  if (!file) return null
  const pdf = file.mime === "application/pdf"
  return presignGet(file.s3Key, file.name.split("/").pop()!, {
    inline: pdf,
    type: pdf ? "application/pdf" : undefined,
  })
}

// "Save to my Nimbus": the recipient's own copies in their My files, with the
// same quota check as an upload. Doesn't count as a download.
export async function saveTransfer(
  token: string
): Promise<{ error?: string; saved?: number }> {
  const session = await getSession()
  if (!session || session.user.status !== "active")
    return { error: "Sign in to save these." }
  const me = session.user.id
  const t = await openTransfer(String(token))
  if (!t) return { error: "This link doesn't work any more." }
  const files = await filesOf(t.id)
  const need = files.reduce((n, f) => n + f.size, 0)
  const left = await spaceLeft(me)
  if (left !== null && need > left)
    return {
      error: `This needs ${formatBytes(need)}, but only ${formatBytes(left)} is left in your storage.`,
    }
  const copies: { key: string; file: (typeof files)[number] }[] = []
  try {
    for (const file of files) {
      const key = newKey()
      await copyObject(file.s3Key, key)
      copies.push({ key, file })
      if (file.thumb)
        await copyObject(thumbKey(file.s3Key), thumbKey(key)).catch(() => {})
    }
    const versions = await db.transaction(async (tx) => {
      const cache = new Map<string, string>()
      const ids: string[] = []
      for (const { key, file } of copies) {
        const names = file.name.split("/")
        const name = names.pop()!
        const dir = await mkdirp(tx, me, null, names, cache)
        if ("error" in dir) throw new Error(dir.error)
        const r = await saveUploaded(tx, {
          ownerId: me,
          parentId: dir.id,
          name,
          version: { s3Key: key, size: file.size, mime: file.mime, uploadedBy: me },
          onConflict: "keep",
        })
        if (r.error) throw new Error(r.error)
        if (r.versionId) ids.push(r.versionId)
      }
      return ids
    })
    await logEvent(t.recipientId, "save", `${files.length} files`)
    await checkStorage(me)
    for (const v of versions) await enqueueDerive(v).catch(() => {})
    return { saved: files.length }
  } catch (e) {
    console.error("[transfer] save failed", e)
    await deleteKeys(copies.map((c) => c.key))
    return { error: "Couldn't save the files. Try again." }
  }
}
