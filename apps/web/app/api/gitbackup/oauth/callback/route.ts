import { NextResponse, type NextRequest } from "next/server"

import { decrypt } from "@/lib/crypto"
import { createConnection } from "@/lib/gitbackup/connections"
import { whoami } from "@/lib/gitbackup/github"
import { redis } from "@/lib/redis"
import { memberOrNull } from "@/lib/session"
import { getSettings } from "@/lib/signup"
import { db } from "@/lib/db"
import { gitBackupConnections } from "@/lib/db/schema"
import { and, eq, sql } from "drizzle-orm"

const base = () => (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "")
const back = (q: string) => {
  const res = NextResponse.redirect(`${base()}/more/github-backup?${q}`)
  res.cookies.delete({ name: "gitbackup_oauth", path: "/api/gitbackup/oauth" })
  return res
}

export async function GET(req: NextRequest) {
  const me = await memberOrNull()
  if (!me) return NextResponse.redirect(`${base()}/sign-in`)
  const state = req.nextUrl.searchParams.get("state") ?? ""
  const code = req.nextUrl.searchParams.get("code")
  const owner = state ? await redis.getdel(`gitbackup:oauth:${state}`).catch(() => null) : null
  if (!state || owner !== me.id || req.cookies.get("gitbackup_oauth")?.value !== state) return back("oauth_error=state")
  if (!code) return back("oauth_error=denied")
  const s = await getSettings()
  const secret = s.githubOauthClientSecret ? decrypt(s.githubOauthClientSecret) : null
  if (!s.gitBackupEnabled || !s.githubOauthClientId || !secret) return back("oauth_error=off")
  let token: string | undefined
  try {
    const r = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": "nimbus-gitbackup" },
      body: JSON.stringify({ client_id: s.githubOauthClientId, client_secret: secret, code, redirect_uri: `${base()}/api/gitbackup/oauth/callback` }),
      signal: AbortSignal.timeout(15_000),
    })
    token = ((await r.json()) as { access_token?: string }).access_token
  } catch {}
  if (!token) return back("oauth_error=exchange")
  // Named after the account; a second connect for the same account gets "(OAuth)" added.
  const login = await whoami({ token, host: null }).then((w) => w.login, () => null)
  if (!login) return back("oauth_error=exchange")
  const [taken] = await db.select({ id: gitBackupConnections.id }).from(gitBackupConnections).where(and(eq(gitBackupConnections.userId, me.id), sql`lower(${gitBackupConnections.name}) = ${login.toLowerCase()}`))
  const r = await createConnection(me.id, { token, via: "oauth", name: taken ? `${login} (OAuth)` : login })
  return r.id ? back(`connected=${r.id}`) : back("oauth_error=save")
}
