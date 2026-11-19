// What every git host module (github.ts, gitlab.ts, gitea.ts) shares: the shapes, the checked fetch, the repo-list cache.
import "server-only"

import { redis } from "@/lib/redis"
import { checkUrl, dialable, allowPrivate } from "@/lib/secrets/webhooks"
import { hostBase, type Provider } from "./refs.ts"

export type { Provider }
export class GhError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

// host: a self-hosted server (null = the provider's cloud). account: the token's login (Gitea and Forgejo clone with it).
export type Cfg = { token: string; host: string | null; account?: string | null }
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
// me: the token's own account (other "User" owners are people whose repos you collaborate on).
export type Owner = { login: string; type: "User" | "Organization"; me?: boolean }
export type RepoList = { repos: RepoInfo[]; owners: Owner[]; at: string }
export type Who = { login: string; scopes: string[]; expiresAt: Date | null }

// A self-hosted address is the member's to type: it must not lead to a private address (unless an admin allows that),
// and plain http only goes with that same allowance. Checked on every call.
export async function guard(host: string | null) {
  if (!host) return
  const u = checkUrl(hostBase(host))
  if (u.protocol === "http:" && !(await allowPrivate())) throw new Error("Use an https:// address for this server.")
  await dialable(u)
}

// One call to a host's API. label: "GitLab" in messages. Throws GhError (status set when the host answered).
export async function call(host: string | null, label: string, url: string, init: { method?: string; headers: Record<string, string>; body?: unknown }): Promise<Response> {
  await guard(host).catch((e: Error) => Promise.reject(new GhError(e.message)))
  let res: Response
  try {
    res = await fetch(url, {
      method: init.method,
      headers: { "user-agent": "nimbus-gitbackup", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
      body: init.body ? JSON.stringify(init.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new GhError(`Couldn't reach ${host ?? label}.`)
  }
  if (res.status === 401) throw new GhError(`${label} didn't accept that token.`, 401)
  if (res.status === 429) throw new GhError(`${label}'s rate limit is used up. Try again in a few minutes.`, 429)
  if (!res.ok) throw new GhError(`${label} answered ${res.status}.`, res.status)
  return res
}

// Cached five minutes per connection (`key`), so the picker opens fast; `refresh` skips the cache.
export async function cached(key: string, refresh: boolean, fetchAll: () => Promise<RepoList>): Promise<RepoList> {
  const k = `gitbackup:repos:${key}`
  if (!refresh) {
    const hit = await redis.get(k).catch(() => null)
    if (hit) return JSON.parse(hit) as RepoList
  }
  const list = await fetchAll()
  await redis.set(k, JSON.stringify(list), "EX", 300).catch(() => {})
  return list
}

// The owners the picker offers: the token's own account first, then its orgs, then anyone else whose repos it reaches.
export function owners(me: string, orgs: string[], repos: RepoInfo[]): Owner[] {
  const out = new Map<string, Owner>([[me.toLowerCase(), { login: me, type: "User", me: true }]])
  for (const o of orgs) out.set(o.toLowerCase(), { login: o, type: "Organization" })
  for (const r of repos) if (!out.has(r.owner.toLowerCase())) out.set(r.owner.toLowerCase(), { login: r.owner, type: r.ownerType })
  return [...out.values()]
}
