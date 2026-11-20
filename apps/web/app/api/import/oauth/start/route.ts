// "Connect Google Drive / Photos / Dropbox / OneDrive": sends the member to the service's consent page. The state lives in Redis
// (bound to the member and the provider) and in a cookie, so the callback only accepts a flow this browser started.
import { randomBytes } from "node:crypto"

import { NextResponse, type NextRequest } from "next/server"

import { authorizeUrl, oauthApp } from "@/lib/import/connections"
import { PROVIDERS } from "@/lib/import/rules"
import { redis } from "@/lib/redis"
import { memberOrNull } from "@/lib/session"
import { getSettings } from "@/lib/signup"

const base = () => (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "")

export async function GET(req: NextRequest) {
  const me = await memberOrNull()
  if (!me) return NextResponse.redirect(`${base()}/sign-in`)
  const p = req.nextUrl.searchParams.get("provider") ?? ""
  const s = await getSettings()
  const app = p in PROVIDERS && PROVIDERS[p as keyof typeof PROVIDERS].oauth ? oauthApp(s, p as "gdrive") : null
  if (!s.importToolEnabled || !app) return NextResponse.redirect(`${base()}/more/import?oauth_error=off`)
  const state = randomBytes(24).toString("base64url")
  await redis.set(`import:oauth:${state}`, `${me.id}:${p}`, "EX", 600)
  const res = NextResponse.redirect(authorizeUrl(app, state))
  res.cookies.set("import_oauth", state, { httpOnly: true, sameSite: "lax", secure: base().startsWith("https://"), path: "/api/import/oauth", maxAge: 600 })
  return res
}
