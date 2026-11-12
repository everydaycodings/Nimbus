"use server"

import { and, count, eq, gt, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { linkEvents } from "@/lib/db/schema"
import { message, sendInBackground } from "@/lib/email"
import { formatBytes, typeAllowed, typesLabel } from "@/lib/file-rules"
import {
  clientIp,
  dropAllowed,
  findLink,
  linkNode,
  logLinkEvent,
  openLink,
  unlock,
} from "@/lib/links"
import { spaceLeft } from "@/lib/quota"
import { albumPreviewUrl } from "@/app/a/actions"
import { transferPreviewUrl } from "@/app/t/actions"
import { presignGet } from "@/lib/s3"
import { signUploadToken, splitPath } from "@/lib/upload-rules"
import {
  dropped,
  finishTusUpload,
  mkdirp,
  rejectReason,
  uploadLimits,
} from "@/lib/uploads"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  // The shared Previewer passes transfer tokens as "t:<token>".
  if (String(token).startsWith("t:"))
    return transferPreviewUrl(String(token).slice(2), id)
  if (String(token).startsWith("a:"))
    return albumPreviewUrl(String(token).slice(2), id)
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

// Permission to send one file into a file-drop link's folder (or the visitor's
// own folder inside it, when the link asks for that).
export async function linkUploadToken(
  token: string,
  folderId: string,
  name: string,
  size: number,
  uploader: string,
  email = ""
): Promise<{ token?: string; error?: string }> {
  const link = await openLink(String(token))
  if (!link?.allowUpload) return { error: "This link doesn't take uploads." }
  const folder = await linkNode(link, String(folderId))
  if (folder?.kind !== "folder") return { error: "That folder is gone." }
  if (!splitPath(name) || String(name).includes("/"))
    return { error: "That name can't be used." }
  const who = String(uploader ?? "").trim().slice(0, 60)
  const mail = String(email ?? "").trim().slice(0, 120)
  if (!who) return { error: "Enter your name first." }
  if (mail && !EMAIL.test(mail)) return { error: "That email doesn't look right." }
  if (link.requireEmail && !mail) return { error: "Enter your email first." }
  if (!(await dropAllowed()))
    return { error: "Too many uploads from here. Try again in an hour." }
  const bytes = Number(size) || 0
  const reason = rejectReason(name, bytes, await uploadLimits())
  if (reason) return { error: reason }
  if (!typeAllowed(name, link.allowedTypes))
    return {
      error: `This link only takes ${typesLabel(link.allowedTypes!)}.`,
    }
  if (link.maxFileBytes && bytes > link.maxFileBytes)
    return { error: `Files here can be up to ${formatBytes(link.maxFileBytes)}.` }
  const sofar = await dropped(link.id)
  if (
    (link.uploadCapBytes !== null && sofar.bytes + bytes > link.uploadCapBytes) ||
    (link.maxFiles && sofar.files >= link.maxFiles)
  )
    return { error: "This link has taken all the files it can." }
  const left = await spaceLeft(link.ownerId)
  if (left !== null && bytes > left)
    return {
      error: `There's only ${formatBytes(left)} of space left here.`,
    }
  let parent = folder.id
  if (link.perVisitorFolder) {
    // ponytail: two visitors with the same name share a folder; add the email if that bites.
    const dir = await mkdirp(db, link.ownerId, folder.id, [
      who.replace(/[\\/:*?"<>|]/g, "-").replace(/^\.+/, "") || "Visitor",
    ])
    if ("error" in dir) return { error: dir.error }
    parent = dir.id!
  }
  return {
    token: signUploadToken(link.ownerId, parent, Date.now(), {
      s: link.id,
      l: (mail ? `${who} <${mail}>` : who).slice(0, 80),
      i: (await clientIp()) ?? undefined,
    }),
  }
}

// "We got your files": one email per batch, if the visitor gave an address.
export async function finishDrop(token: string, email: string, names: string[]) {
  const link = await openLink(String(token))
  const to = String(email ?? "").trim()
  const files = (Array.isArray(names) ? names : []).map(String).slice(0, 200)
  if (!link?.allowUpload || !EMAIL.test(to) || !files.length) return
  // ponytail: 5 confirmations per IP an hour, counted from the link log.
  const ip = await clientIp()
  const [{ n }] = await db
    .select({ n: count() })
    .from(linkEvents)
    .where(
      and(
        eq(linkEvents.kind, "confirm"),
        ip ? eq(linkEvents.ip, ip) : sql`${linkEvents.ip} is null`,
        gt(linkEvents.at, sql`now() - interval '1 hour'`)
      )
    )
  if (n >= 5) return
  await logLinkEvent(link.id, "confirm", to)
  const what = files.length === 1 ? `“${files[0]}”` : `${files.length} files`
  sendInBackground(
    message({
      to,
      subject: `${link.ownerName} got your files`,
      heading: "Your files arrived",
      lines: [
        `${what} reached ${link.ownerName} through “${link.name ?? link.itemName}”.`,
        ...(files.length > 1 ? [files.slice(0, 20).join(", ") + (files.length > 20 ? "…" : "")] : []),
      ],
      footer: "You get this because you gave your email when sending files.",
    })
  )
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
