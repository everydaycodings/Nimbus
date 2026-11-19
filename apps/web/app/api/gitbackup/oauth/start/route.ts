// "Connect GitHub": sends the member to GitHub's consent page. The state lives in Redis (bound to the member)
// and in a cookie, so the callback only accepts a flow this browser started.
import { randomBytes } from "node:crypto"

import { NextResponse } from "next/server"

import { redis } from "@/lib/redis"
import { memberOrNull } from "@/lib/session"
import { getSettings } from "@/lib/signup"

const base = () => (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "")

export async function GET() {
  const me = await memberOrNull()
  if (!me) return NextResponse.redirect(`${base()}/sign-in`)
  const s = await getSettings()
  if (!s.gitBackupEnabled || !s.githubOauthClientId || !s.githubOauthClientSecret) return NextResponse.redirect(`${base()}/more/github-backup?oauth_error=off`)
  const state = randomBytes(24).toString("base64url")
  await redis.set(`gitbackup:oauth:${state}`, me.id, "EX", 600)
  const url = new URL("https://github.com/login/oauth/authorize")
  url.search = new URLSearchParams({ client_id: s.githubOauthClientId, redirect_uri: `${base()}/api/gitbackup/oauth/callback`, scope: "repo read:org", state }).toString()
  const res = NextResponse.redirect(url)
  res.cookies.set("gitbackup_oauth", state, { httpOnly: true, sameSite: "lax", secure: base().startsWith("https://"), path: "/api/gitbackup/oauth", maxAge: 600 })
  return res
}
