"use server"

import { answerLink, linkState, startLink } from "@/lib/device-link"
import { formatCode, linkUri } from "@/lib/device-link-rules"
import { UUID } from "@/lib/file-rules"
import { requireMember } from "@/lib/session"
import { getSettings } from "@/lib/signup"

// A fresh QR and code. `server` is the address the device should use, from the
// browser's own address bar: it can only point the QR, never grant anything.
export async function startDeviceLink(server: string) {
  const me = await requireMember()
  if (!(await getSettings()).deviceLinks) return null
  const { id, token, code, expiresAt } = await startLink(me.id)
  return {
    id,
    uri: linkUri(server, token),
    code: formatCode(code),
    expiresAt: expiresAt.getTime(),
  }
}

export async function deviceLinkState(id: string) {
  const me = await requireMember()
  return UUID.test(id) ? linkState(me.id, id) : null
}

export async function answerDeviceLink(id: string, allow: boolean) {
  const me = await requireMember()
  return UUID.test(id) ? answerLink(me.id, id, allow === true) : false
}
