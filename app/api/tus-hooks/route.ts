// tusd v2 HTTP hooks (-hooks-http). tusd POSTs {Type, Event: {Upload, HTTPRequest}}
// and reads {RejectUpload, HTTPResponse} back, as JSON, from a 2xx response.
import { createHash, timingSafeEqual } from "node:crypto"

import { formatBytes } from "@/lib/file-rules"
import { enqueue } from "@/lib/redis"
import { spaceLeft } from "@/lib/quota"
import { readUploadToken, splitPath } from "@/lib/upload-rules"
import {
  droppedBytes,
  dropLink,
  finishTusUpload,
  isSealedName,
  rejectReason,
  uploadLimits,
  uploaderMayAdd,
} from "@/lib/uploads"

type Upload = {
  ID: string
  Size: number
  SizeIsDeferred: boolean
  MetaData: Record<string, string>
}

const sha = (s: string) => createHash("sha256").update(s).digest()

// Only tusd should call this. tusd can't add headers of its own, so the secret
// rides in the hook URL: -hooks-http http://app/api/tus-hooks?secret=…
// Unset (dev) lets anyone call it.
function fromTusd(req: Request) {
  const secret = process.env.TUS_HOOK_SECRET
  if (!secret) return true
  const got = new URL(req.url).searchParams.get("secret") ?? ""
  return timingSafeEqual(sha(got), sha(secret))
}

async function whyNot(upload: Upload) {
  const meta = upload.MetaData ?? {}
  const token = readUploadToken(meta.token)
  if (!token || token.exp < Date.now())
    return "This upload's permission ran out. Start it again."
  // Vault names are sealed, so only the size limit applies to them; the
  // browser checks blocked types before encrypting.
  let name = splitPath(meta.path)?.at(-1)
  if (token.v)
    name = [meta.filename, meta.encKey, meta.nameTag].every(isSealedName)
      ? ""
      : undefined
  if (name === undefined) return "That name can't be used."
  if (upload.SizeIsDeferred) return "Uploads need a size up front."
  if (!(await uploaderMayAdd(token)))
    return "The folder for this upload is gone, or you can no longer add to it."
  const reason = rejectReason(name, upload.Size, await uploadLimits())
  if (reason) return reason
  if (token.s) {
    const link = await dropLink(token.s)
    if (
      link?.cap != null &&
      (await droppedBytes(token.s)) + upload.Size > link.cap
    )
      return "This link has taken all the files it can."
  }
  // ponytail: each upload is checked alone, so parallel uploads can overshoot
  // the quota by what's in flight; reserve space per upload if that matters.
  const left = await spaceLeft(token.u)
  if (left !== null && upload.Size > left)
    return !token.b && !token.s
      ? `Not enough space: ${formatBytes(left)} left in this account.`
      : `Not enough space: the folder's owner has ${formatBytes(left)} left.`
  return null
}

export async function POST(req: Request) {
  if (!fromTusd(req)) return new Response("Forbidden", { status: 403 })
  const hook = (await req.json()) as { Type: string; Event: { Upload: Upload } }
  const upload = hook.Event?.Upload

  if (hook.Type === "pre-create") {
    const reason = await whyNot(upload)
    if (reason)
      return Response.json({
        RejectUpload: true,
        HTTPResponse: {
          StatusCode: 403,
          Body: reason,
          Header: { "Content-Type": "text/plain; charset=utf-8" },
        },
      })
  }

  // tusd has already answered the client and never calls again, so a crash
  // (database away) goes to the worker to retry. The client's own finishUpload
  // call is the other chance to land it.
  if (hook.Type === "post-finish") {
    try {
      const done = await finishTusUpload(upload.ID)
      if (done.error) console.error("post-finish", upload.ID, done.error)
    } catch (e) {
      console.error("post-finish", upload.ID, e)
      await enqueue("tus-finish", { id: upload.ID }).catch(() => {})
    }
  }

  return Response.json({})
}
