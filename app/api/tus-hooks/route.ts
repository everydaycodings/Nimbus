// tusd v2 HTTP hooks (-hooks-http). tusd POSTs {Type, Event: {Upload, HTTPRequest}}
// and reads {RejectUpload, HTTPResponse} back, as JSON, from a 2xx response.
import { createHash, timingSafeEqual } from "node:crypto"

import { formatBytes } from "@/lib/file-rules"
import { spaceLeft } from "@/lib/quota"
import { readUploadToken, splitPath } from "@/lib/upload-rules"
import {
  finishTusUpload,
  isActiveUser,
  isOpenFolder,
  rejectReason,
  uploadLimits,
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
  const names = splitPath(meta.path)
  if (!names) return "That name can't be used."
  if (upload.SizeIsDeferred) return "Uploads need a size up front."
  if (!(await isActiveUser(token.u)) || !(await isOpenFolder(token.u, token.p)))
    return "The folder for this upload is gone."
  const reason = rejectReason(names.at(-1)!, upload.Size, await uploadLimits())
  if (reason) return reason
  // ponytail: each upload is checked alone, so parallel uploads can overshoot
  // the quota by what's in flight; reserve space per upload if that matters.
  const left = await spaceLeft(token.u)
  if (left !== null && upload.Size > left)
    return `Not enough space: ${formatBytes(left)} left in this account.`
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

  // tusd has already answered the client, so failures are only logged. The
  // client's own finishUpload call is the other chance to land it.
  if (hook.Type === "post-finish") {
    try {
      const done = await finishTusUpload(upload.ID)
      if (done.error) console.error("post-finish", upload.ID, done.error)
    } catch (e) {
      console.error("post-finish", upload.ID, e)
    }
  }

  return Response.json({})
}
