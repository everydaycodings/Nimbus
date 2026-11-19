// GitHub for Git Backup through plain fetch: who a token is, and every repo it can see (for the picker).
// host: a GitHub Enterprise server (null = github.com). GITHUB_API_URL points tests at a fake when host is null.
import "server-only"

import { redis } from "@/lib/redis"
import { checkUrl, dialable } from "@/lib/secrets/webhooks"

export class GhError extends Error {}

export type Cfg = { token: string; host: string | null }
export type RepoInfo = {
  owner: string
  ownerType: "User" | "Organization"
  name: string
  fullName: string
  private: boolean
  fork: boolean
  archived: boolean
  pushedAt: string | null
  createdAt: string | null
  // Bytes (GitHub reports KB).
  size: number
  cloneUrl: string
  defaultBranch: string
}
export type Owner = { login: string; type: "User" | "Organization" }

const api = (host: string | null) => (host ? `https://${host}/api/v3` : (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, ""))

async function get(c: Cfg, path: string): Promise<Response> {
  // An Enterprise host is the member's to type: it must not lead to a private address (checked on every call).
  if (c.host) await dialable(checkUrl(`https://${c.host}`)).catch((e: Error) => Promise.reject(new GhError(e.message)))
  let res: Response
  try {
    res = await fetch(`${api(c.host)}${path}`, {
      headers: { authorization: `Bearer ${c.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "nimbus-gitbackup" },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new GhError(`Couldn't reach ${c.host ?? "GitHub"}.`)
  }
  if (res.status === 401) throw new GhError("GitHub didn't accept that token.")
  if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) throw new GhError("GitHub's rate limit is used up. Try again in a few minutes.")
  if (!res.ok) throw new GhError(`GitHub answered ${res.status}.`)
  return res
}

// Login, scopes (classic tokens say them in a header; fine-grained tokens send none) and expiry.
export async function whoami(c: Cfg): Promise<{ login: string; scopes: string[]; expiresAt: Date | null }> {
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

export type RepoList = { repos: RepoInfo[]; owners: Owner[]; at: string }

async function fetchAll(c: Cfg): Promise<RepoList> {
  const [raw, orgs, me] = await Promise.all([
    pages<Raw>(c, "/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed"),
    pages<{ login: string }>(c, "/user/orgs", 5).catch(() => []),
    whoami(c),
  ])
  // The runner clones (with the token) from cloneUrl, so only https addresses on the API's own host are kept.
  const home = c.host ?? (process.env.GITHUB_API_URL ? null : "github.com")
  const safe = (u: string) => {
    try {
      const x = new URL(u)
      return home ? x.protocol === "https:" && x.host === home : true
    } catch {
      return false
    }
  }
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
  const owners = new Map<string, Owner>([[me.login.toLowerCase(), { login: me.login, type: "User" }]])
  for (const o of orgs) owners.set(o.login.toLowerCase(), { login: o.login, type: "Organization" })
  for (const r of repos) if (!owners.has(r.owner.toLowerCase())) owners.set(r.owner.toLowerCase(), { login: r.owner, type: r.ownerType })
  return { repos, owners: [...owners.values()], at: new Date().toISOString() }
}

// Cached five minutes per connection (`key`), so the picker opens fast; `refresh` skips the cache.
export async function repoList(key: string, c: Cfg, refresh = false): Promise<RepoList> {
  const k = `gitbackup:repos:${key}`
  if (!refresh) {
    const hit = await redis.get(k).catch(() => null)
    if (hit) return JSON.parse(hit) as RepoList
  }
  const list = await fetchAll(c)
  await redis.set(k, JSON.stringify(list), "EX", 300).catch(() => {})
  return list
}
