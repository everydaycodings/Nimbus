// Gitea and Forgejo (one API, /api/v1) for Git Backup. A server is always self-hosted, so the host is required.
// Neither says what a token may do or when it ends, so scopes are empty and expiry null.
import "server-only"

import { cached, call, GhError, owners as ownerList, type Cfg, type RepoInfo, type RepoList, type Who } from "./host.ts"
import { hostBase, type Provider } from "./refs.ts"

export const apiBase = (host: string | null) => `${hostBase(host!)}/api/v1`

const get = (c: Cfg, label: string, path: string, init: { method?: string; body?: unknown } = {}) =>
  call(c.host, label, `${apiBase(c.host)}${path}`, { ...init, headers: { authorization: `token ${c.token}`, accept: "application/json" } })

// label: "Gitea" or "Forgejo", for messages.
export const whoami = (label: string) => async (c: Cfg): Promise<Who> => {
  const login = ((await (await get(c, label, "/user")).json().catch(() => ({}))) as { login?: string }).login
  if (!login) throw new GhError(`${label} didn't say whose token this is.`)
  return { login, scopes: [], expiresAt: null }
}

type Raw = {
  name: string
  full_name: string
  private: boolean
  fork: boolean
  archived: boolean
  updated_at: string | null
  created_at: string | null
  size: number
  default_branch: string
  owner: { login: string }
}

// Gitea caps a page at 50 by default, so a page is read until one comes back empty.
async function pages<T>(c: Cfg, label: string, path: string, max = 40): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page <= max; page++) {
    const rows = (await (await get(c, label, `${path}${path.includes("?") ? "&" : "?"}limit=50&page=${page}`)).json()) as T[]
    if (!rows.length) break
    out.push(...rows)
  }
  return out
}

const fetchAll = (label: string) => async (c: Cfg): Promise<RepoList> => {
  const [raw, orgs, me] = await Promise.all([pages<Raw>(c, label, "/user/repos"), pages<{ username?: string; name?: string }>(c, label, "/user/orgs", 5).catch(() => []), whoami(label)(c)])
  const names = orgs.map((o) => o.username ?? o.name ?? "").filter(Boolean)
  const isOrg = new Set(names.map((n) => n.toLowerCase()))
  // Cloned from the connection's own host, whatever ROOT_URL the server was set up with.
  const repos: RepoInfo[] = raw.map((r) => ({
    owner: r.owner.login,
    ownerType: isOrg.has(r.owner.login.toLowerCase()) ? "Organization" : "User",
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    fork: r.fork,
    archived: r.archived,
    pushedAt: r.updated_at,
    createdAt: r.created_at,
    size: r.size * 1024,
    cloneUrl: `${hostBase(c.host!)}/${r.full_name}.git`,
    defaultBranch: r.default_branch,
  }))
  return { repos, owners: ownerList(me.login, names, repos), at: new Date().toISOString() }
}

export const repoList = (label: string) => (key: string, c: Cfg, refresh = false) => cached(key, refresh, () => fetchAll(label)(c))

export async function setHook(provider: Provider, c: Cfg, full: string, url: string, secret: string, on: boolean) {
  const label = provider === "forgejo" ? "Forgejo" : "Gitea"
  const p = `/repos/${full}/hooks`
  const hooks = (await (await get(c, label, `${p}?limit=50`)).json()) as { id: number; config?: { url?: string } }[]
  for (const h of hooks.filter((h) => h.config?.url === url)) await get(c, label, `${p}/${h.id}`, { method: "DELETE" })
  if (on) await get(c, label, p, { method: "POST", body: { type: provider, active: true, events: ["push", "create"], config: { url, content_type: "json", secret } } })
}
