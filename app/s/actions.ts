"use server"

import { formatBytes } from "@/lib/file-rules"
import {
  clientIp,
  dropAllowed,
  findLink,
  linkNode,
  openLink,
  unlock,
} from "@/lib/links"
import { spaceLeft } from "@/lib/quota"
import { presignGet } from "@/lib/s3"
import { signUploadToken, splitPath } from "@/lib/upload-rules"
import {
  droppedBytes,
  finishTusUpload,
  rejectReason,
  uploadLimits,
} from "@/lib/uploads"

// Anyone with the link can call these, so each one checks the link itself.

export async function unlockLink(
  token: string,
  password: string
): Promise<{ error?: string }> {
  const link = await findLink(String(token))
  if (!link) return { error: "This link doesn't work any more." }
  return unlock(link, String(password ?? ""))
}

export async function linkPreviewUrl(token: string, id: string) {
  const link = await openLink(String(token))
  if (!link?.allowView) return null
  const node = await linkNode(link, String(id))
  if (node?.kind !== "file" || !node.key) return null
  const pdf = node.mime === "application/pdf"
  return presignGet(node.key, node.name, {
    inline: pdf,
    type: pdf ? "application/pdf" : undefined,
  })
}

// Permission to send one file into a file-drop link's folder.
export async function linkUploadToken(
  token: string,
  folderId: string,
  name: string,
  size: number,
  uploader: string
): Promise<{ token?: string; error?: string }> {
  const link = await openLink(String(token))
  if (!link?.allowUpload) return { error: "This link doesn't take uploads." }
  const folder = await linkNode(link, String(folderId))
  if (folder?.kind !== "folder") return { error: "That folder is gone." }
  if (!splitPath(name) || String(name).includes("/"))
    return { error: "That name can't be used." }
  if (!(await dropAllowed()))
    return { error: "Too many uploads from here. Try again in an hour." }
  const bytes = Number(size) || 0
  const reason = rejectReason(name, bytes, await uploadLimits())
  if (reason) return { error: reason }
  if (
    link.uploadCapBytes !== null &&
    (await droppedBytes(link.id)) + bytes > link.uploadCapBytes
  )
    return { error: "This link has taken all the files it can." }
  const left = await spaceLeft(link.ownerId)
  if (left !== null && bytes > left)
    return {
      error: `There's only ${formatBytes(left)} of space left here.`,
    }
  return {
    token: signUploadToken(link.ownerId, folder.id, Date.now(), {
      s: link.id,
      l:
        String(uploader ?? "")
          .trim()
          .slice(0, 80) || undefined,
      i: (await clientIp()) ?? undefined,
    }),
  }
}

export async function finishLinkUpload(token: string, uploadUrl: string) {
  const link = await openLink(String(token))
  if (!link?.allowUpload) return { error: "This link doesn't take uploads." }
  let id = ""
  try {
    id = decodeURIComponent(
      new URL(uploadUrl, "http://x").pathname
        .split("/")
        .filter(Boolean)
        .pop() ?? ""
    )
  } catch {}
  const done = await finishTusUpload(id, { share: link.id })
  return { error: done.error, ok: Boolean(done.nodeId) }
}
