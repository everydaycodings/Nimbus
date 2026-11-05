import { sql } from "drizzle-orm"
import { NextResponse, type NextRequest } from "next/server"

import { appUrl } from "@/lib/email"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { notify } from "@/lib/notify"
import {
  SHARE_INVITE_COOKIE,
  bindShareInvites,
  readShareInvite,
} from "@/lib/signup"

// The emailed "Join and open" link. Remembers the invite so the sign-up that
// follows skips approval and receives the share.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const email = await readShareInvite(token)
  if (!email)
    return NextResponse.redirect(appUrl("/sign-up?invite=invalid"))
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = lower(${email})`)
  // They made an account since: the token proves the inbox is theirs.
  if (existing) {
    for (const b of await bindShareInvites(existing.id, email))
      await notify(existing.id, "shared", {
        nodeId: b.nodeId,
        actorId: b.createdBy,
        data: { role: b.role },
      })
    return NextResponse.redirect(appUrl("/shared"))
  }
  const res = NextResponse.redirect(
    appUrl(`/sign-up?for=${encodeURIComponent(email)}`)
  )
  res.cookies.set(SHARE_INVITE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60,
    path: "/",
  })
  return res
}
