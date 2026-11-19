// GitHub for Git Backup through plain fetch: who a token is, and every repo it can see (for the picker).
// host: a GitHub Enterprise server (null = github.com). GITHUB_API_URL points tests at a fake when host is null.
import "server-only"

import { lsRemote } from "./archive.ts"
import { cached, GhError, guard, owners as ownerList, type Cfg, type Owner, type RepoInfo, type RepoList, type Who } from "./host.ts"
import { FINE_FIX_CONTENTS, FINE_FIX_REPOS, githubFix, githubPerms, type Access } from "./perms.ts"
import { failureKind, hostBase } from "./refs.ts"

export { GhError }
export type { Cfg, Owner, RepoInfo, RepoList }

const api = (host: string | null) => (host ? `${hostBase(host)}/api/v3` : (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, ""))

async function get(c: Cfg, path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  // An Enterprise host is the member's to type: it must not lead to a private address (checked on every call).
  await guard(c.host).catch((e: Error) => Promise.reject(new GhError(e.message)))
  let res: Response
  try {
    res = await fetch(`${api(c.host)}${path}`, {
      method: init.method,
      headers: { authorization: `Bearer ${c.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "nimbus-gitbackup", ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new GhError(`Couldn't reach ${c.host ?? "GitHub"}.`)
  }
  if (res.status === 401) throw new GhError("GitHub didn't accept that token.", 401)
  if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) throw new GhError("GitHub's rate limit is used up. Try again in a few minutes.")
  if (!res.ok) throw new GhError(`GitHub answered ${res.status}.`, res.status)
  return res
}

// Login, scopes (classic tokens say them in a header; fine-grained tokens send none) and expiry.
export async function whoami(c: Cfg): Promise<Who> {
  const res = await get(c, "/user")
  const login = ((await res.json().catch(() => ({}))) as { login?: string }).login
  if (!login) throw new GhError("GitHub didn't say whose token this is.")
  const scopes = (res.headers.get("x-oauth-scopes") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  // "2026-12-01 10:00:00 UTC"
  const exp = res.headers.get("github-authentication-token-expiration")
  const at = exp ? new Date(exp.replace(" UTC", "Z").replace(" ", "T")) : null
  return { login, scopes, expiresAt: at && !Number.isNaN(at.getTime()) ? at : null }
}

type Raw = {
  name: string
  full_name: string
  private: boolean
  fork: boolean
  archived: boolean
  pushed_at: string | null
  created_at?: string | null
  size: number
  clone_url: string
  default_branch: string
  owner: { login: string; type: string }
}

async function pages<T>(c: Cfg, path: string, max = 30): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page <= max; page++) {
    const rows = (await (await get(c, `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`)).json()) as T[]
    out.push(...rows)
    if (rows.length < 100) break
  }
  return out
}


// The runner clones (with the token) from cloneUrl, so only https addresses on the API's own host are kept.
const cloneOk = (c: Cfg) => {
  const home = c.host ? new URL(hostBase(c.host)) : process.env.GITHUB_API_URL ? null : new URL("https://github.com")
  return (u: string) => {
    try {
      const x = new URL(u)
      return home ? x.protocol === home.protocol && x.host === home.host : true
    } catch {
      return false
    }
  }
}

async function fetchAll(c: Cfg): Promise<RepoList> {
  const [raw, orgs, me] = await Promise.all([
    pages<Raw>(c, "/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed"),
    pages<{ login: string }>(c, "/user/orgs", 5).catch(() => []),
    whoami(c),
  ])
  const safe = cloneOk(c)
  const repos = raw.filter((r) => safe(r.clone_url)).map((r) => ({
    owner: r.owner.login,
    ownerType: (r.owner.type === "Organization" ? "Organization" : "User") as RepoInfo["ownerType"],
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    fork: r.fork,
    archived: r.archived,
    pushedAt: r.pushed_at,
    createdAt: r.created_at ?? null,
    size: r.size * 1024,
    cloneUrl: r.clone_url,
    defaultBranch: r.default_branch,
  }))
  const owners = ownerList(me.login, orgs.map((o) => o.login), repos)
  return { repos, owners, at: new Date().toISOString() }
}

export const repoList = (key: string, c: Cfg, refresh = false) => cached(key, refresh, () => fetchAll(c))
export const apiBase = api

// Turns one repo's push hook on or off: ours (by URL) are removed first, so a second toggle doesn't stack hooks.
export async function setHook(c: Cfg, full: string, url: string, secret: string, on: boolean) {
  const hooks = (await (await get(c, `/repos/${full}/hooks?per_page=100`)).json()) as { id: number; config?: { url?: string } }[]
  for (const h of hooks.filter((h) => h.config?.url === url)) await get(c, `/repos/${full}/hooks/${h.id}`, { method: "DELETE" })
  if (on) await get(c, `/repos/${full}/hooks`, { method: "POST", body: { name: "web", active: true, events: ["push", "create"], config: { url, content_type: "json", secret, insecure_ssl: "0" } } })
}

// Which permissions the token has. A classic token lists its scopes in a header. A fine-grained one doesn't, so the honest
// check is access: can it see a repo, and can git read one (a real ls-remote, the token sent as a header, never in argv or URL).
// Webhook rights can't be tried without adding a webhook, so those say "can't tell".
export async function checkAccess(c: Cfg): Promise<Access> {
  const header = (await get(c, "/user")).headers.get("x-oauth-scopes")
  if (header !== null) {
    const perms = githubPerms(header.split(",").map((s) => s.trim()).filter(Boolean))
    return { perms, fix: githubFix(perms) }
  }
  const rows = (await (await get(c, "/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100")).json()) as Raw[]
  const safe = cloneOk(c)
  const repos = rows.filter((r) => safe(r.clone_url))
  const pick = repos.find((r) => r.private) ?? repos[0]
  let contents: boolean | null = null
  let note: string | undefined
  if (pick) {
    try {
      await lsRemote(pick.clone_url, { token: c.token, user: "x-access-token", noRedirects: Boolean(c.host), timeout: 20_000 })
      contents = true
    } catch (e) {
      const kind = failureKind((e as Error).message)
      contents = kind ? false : null
      if (!kind) note = "Couldn't read a repo to check the Contents permission."
    }
  }
  const perms = [
    { name: "Repository access", ok: pick ? true : false, required: true, why: "see at least one repo" },
    { name: "Contents: Read-only", ok: contents, required: true, why: "clone your repos, private ones included" },
    { name: "Webhooks: Read and write", ok: null, required: false, why: "add the webhook that starts a backup on push" },
  ]
  return { perms, note, fix: !pick ? FINE_FIX_REPOS : contents === false ? FINE_FIX_CONTENTS : undefined }
}
