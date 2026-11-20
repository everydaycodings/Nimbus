import { NextResponse, type NextRequest } from "next/server"

import { addFromOAuth, exchangeCode, oauthApp } from "@/lib/import/connections"
import { PROVIDERS } from "@/lib/import/rules"
import { redis } from "@/lib/redis"
import { memberOrNull } from "@/lib/session"
import { getSettings } from "@/lib/signup"

const base = () => (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "")
const back = (q: string) => {
  const res = NextResponse.redirect(`${base()}/more/import?${q}`)
  res.cookies.delete({ name: "import_oauth", path: "/api/import/oauth" })
  return res
}

export async function GET(req: NextRequest) {
  const me = await memberOrNull()
  if (!me) return NextResponse.redirect(`${base()}/sign-in`)
  const state = req.nextUrl.searchParams.get("state") ?? ""
  const code = req.nextUrl.searchParams.get("code")
  const saved = state ? await redis.getdel(`import:oauth:${state}`).catch(() => null) : null
  const [owner, p] = (saved ?? "").split(":")
  if (!state || owner !== me.id || req.cookies.get("import_oauth")?.value !== state || !(p in PROVIDERS)) return back("oauth_error=state")
  if (!code) return back("oauth_error=denied")
  const s = await getSettings()
  const provider = p as "gdrive" | "gphotos" | "dropbox" | "onedrive"
  const app = oauthApp(s, provider)
  if (!s.importToolEnabled || !app) return back("oauth_error=off")
  const token = await exchangeCode(app, code).catch(() => null)
  if (!token?.refresh_token) return back("oauth_error=exchange")
  const r = await addFromOAuth(me.id, provider, token)
  return "error" in r ? back(`oauth_error=save&detail=${encodeURIComponent(r.error.slice(0, 200))}`) : back(`connected=${r.id}`)
}
