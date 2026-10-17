import { NextResponse, type NextRequest } from "next/server"

import { INVITE_COOKIE, findInvite } from "@/lib/signup"

// Remembers a valid invite in a cookie so the sign-up that follows (email or OAuth)
// can redeem it, then hands off to the sign-up page.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const valid = await findInvite(token)
  const res = NextResponse.redirect(
    new URL(valid ? "/sign-up" : "/sign-up?invite=invalid", req.url)
  )
  if (valid)
    res.cookies.set(INVITE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60,
      path: "/",
    })
  return res
}
