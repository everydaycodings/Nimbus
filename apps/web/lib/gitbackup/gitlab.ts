// GitLab (gitlab.com or self-hosted) for Git Backup: PRIVATE-TOKEN against /api/v4.
// Owner = the project's namespace path, so a subgroup is "group/sub" and the repo's full name is "group/sub/repo".
import "server-only"

import { cached, call, GhError, owners as ownerList, type Cfg, type RepoInfo, type RepoList, type Who } from "./host.ts"
import { gitlabFix, gitlabPerms, unknownPerms, type Access } from "./perms.ts"
import { hostBase } from "./refs.ts"

const base = (host: string | null) => host ? hostBase(host) : "https://gitlab.com"
export const apiBase = (host: string | null) => `${base(host)}/api/v4`

const get = (c: Cfg, path: string, init: { method?: string; body?: unknown } = {}) => call(c.host, "GitLab", `${apiBase(c.host)}${path}`, { ...init, headers: { "private-token": c.token, accept: "application/json" } })

// Login, scopes and expiry (a personal or project token says them at /personal_access_tokens/self; other tokens don't).
export async function whoami(c: Cfg): Promise<Who> {
  const login = ((await (await get(c, "/user")).json().catch(() => ({}))) as { username?: string }).username
  if (!login) throw new GhError("GitLab didn't say whose token this is.")
  const self = (await (await get(c, "/personal_access_tokens/self").catch(() => null))?.json().catch(() => null)) as { scopes?: string[]; expires_at?: string | null } | null
  const at = self?.expires_at ? new Date(`${self.expires_at}T00:00:00Z`) : null
  return { login, scopes: self?.scopes ?? [], expiresAt: at && !Number.isNaN(at.getTime()) ? at : null }
}

type Raw = {
  path: string
  path_with_namespace: string
  visibility: string
  archived: boolean
  forked_from_project?: unknown
  last_activity_at: string | null
  created_at: string | null
  default_branch: string | null
  statistics?: { repository_size?: number }
  namespace: { full_path: string; kind: string }
}

async function pages<T>(c: Cfg, path: string, max = 30): Promise<T[]> {
  const out: T[] = []
  for (let page = "1"; page && Number(page) <= max; ) {
    const res = await get(c, `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`)
    out.push(...((await res.json()) as T[]))
    page = res.headers.get("x-next-page") ?? ""
  }
  return out
}

async function fetchAll(c: Cfg): Promise<RepoList> {
  const [raw, groups, me] = await Promise.all([
    pages<Raw>(c, "/projects?membership=true&statistics=true&order_by=last_activity_at"),
    pages<{ full_path: string }>(c, "/groups?min_access_level=10", 5).catch(() => []),
    whoami(c),
  ])
  // Cloned from the connection's own host, whatever address the server reports for itself.
  const repos: RepoInfo[] = raw.map((r) => ({
    owner: r.namespace.full_path,
    ownerType: r.namespace.kind === "group" ? "Organization" : "User",
    name: r.path,
    fullName: r.path_with_namespace,
    private: r.visibility !== "public",
    fork: Boolean(r.forked_from_project),
    archived: r.archived,
    pushedAt: r.last_activity_at,
    createdAt: r.created_at,
    size: r.statistics?.repository_size ?? 0,
    cloneUrl: `${base(c.host)}/${r.path_with_namespace}.git`,
    defaultBranch: r.default_branch ?? "main",
  }))
  return { repos, owners: ownerList(me.login, groups.map((g) => g.full_path), repos), at: new Date().toISOString() }
}

export const repoList = (key: string, c: Cfg, refresh = false) => cached(key, refresh, () => fetchAll(c))

// The project is addressed by its URL-encoded path. The secret comes back to us as X-Gitlab-Token.
// Tag pushes are their own event on GitLab (GitHub and Gitea send them as push/create).
export async function setHook(c: Cfg, full: string, url: string, secret: string, on: boolean) {
  const p = `/projects/${encodeURIComponent(full)}/hooks`
  const hooks = (await (await get(c, `${p}?per_page=100`)).json()) as { id: number; url?: string }[]
  for (const h of hooks.filter((h) => h.url === url)) await get(c, `${p}/${h.id}`, { method: "DELETE" })
  if (on) await get(c, p, { method: "POST", body: { url, push_events: true, tag_push_events: true, token: secret, enable_ssl_verification: url.startsWith("https:") } })
}

// Scopes from /personal_access_tokens/self. Other kinds of token (OAuth, CI job) have no such page: then nothing can be judged.
export async function checkAccess(c: Cfg): Promise<Access> {
  const self = (await (await get(c, "/personal_access_tokens/self").catch((e: GhError) => (e.status === 404 || e.status === 403 ? null : Promise.reject(e))))?.json().catch(() => null)) as { scopes?: string[] } | null
  if (!self?.scopes) return unknownPerms(gitlabPerms([]), "GitLab doesn't list this kind of token's scopes.")
  const perms = gitlabPerms(self.scopes)
  return { perms, fix: gitlabFix(perms) }
}
