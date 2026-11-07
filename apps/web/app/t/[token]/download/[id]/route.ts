import { NextResponse } from "next/server"

import { presignGet } from "@/lib/s3"
import {
  countDownload,
  filesOf,
  inVisit,
  logEvent,
  openTransfer,
  visitCookie,
} from "@/lib/transfer-links"

const notFound = () => new Response("Not found", { status: 404 })

// One file of a transfer. The first file in a visit counts as a download for
// the limit (a Download all zip counts once on its own).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params
  const t = await openTransfer(token)
  if (!t) return notFound()
  const file = (await filesOf(t.id)).find((f) => f.id === id)
  if (!file) return notFound()
  const name = file.name.split("/").pop()!
  const res = NextResponse.redirect(await presignGet(file.s3Key, name), 302)
  if (await inVisit(t)) await logEvent(t.recipientId, "download", file.name)
  else if (await countDownload(t, file.name))
    res.headers.append("Set-Cookie", visitCookie(t))
  else return notFound()
  return res
}
