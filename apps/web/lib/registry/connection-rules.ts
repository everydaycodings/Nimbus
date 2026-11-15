// Pure rules for saved git connections. Relative-import safe, so node --test can load it.
export const PROVIDERS = ["github", "gitlab", "gitea", "git", "ssh"] as const
export type Provider = (typeof PROVIDERS)[number]
export const PROVIDER_LABEL: Record<Provider, string> = { github: "GitHub", gitlab: "GitLab", gitea: "Gitea", git: "Git token", ssh: "SSH key" }
export const WARN_DAYS = 7

export const isSshUrl = (url: string) => !/^https?:\/\//i.test(url)

// Which connections a source can use: GitHub sources take GitHub tokens; git sources take the rest,
// and an SSH key only fits an SSH address (tokens only an https:// one).
export function fits(provider: Provider, source: { kind: "github" | "git"; url: string }): boolean {
  if (source.kind === "github") return provider === "github"
  if (provider === "github") return false
  return provider === "ssh" ? isSshUrl(source.url) : !isSshUrl(source.url)
}

// Whole days until `at` (negative once past); null when it never expires.
export function daysLeft(at: Date | null, now = new Date()): number | null {
  return at ? Math.ceil((at.getTime() - now.getTime()) / 86_400_000) : null
}

export type Expiry = { state: "none" | "ok" | "soon" | "expired"; days: number | null }
export function expiryOf(at: Date | null, now = new Date()): Expiry {
  const days = daysLeft(at, now)
  if (days === null) return { state: "none", days }
  return { state: days <= 0 ? "expired" : days <= WARN_DAYS ? "soon" : "ok", days }
}

// One saved credential per (namespace, provider, secret): repos that shared a token share a connection.
export const backfillKey = (namespaceId: string, provider: Provider, secret: string) => `${namespaceId}\u0000${provider}\u0000${secret}`

// What an old per-repo credential becomes: provider and the plain secret plus username.
export function splitLegacy(kind: "github" | "git", plain: string): { provider: Provider; secret: string; username: string | null } | null {
  if (kind === "github") return plain ? { provider: "github", secret: plain, username: null } : null
  try {
    const c = JSON.parse(plain) as { username?: string; token?: string; sshKey?: string }
    if (c.sshKey) return { provider: "ssh", secret: c.sshKey, username: null }
    if (c.token) return { provider: "git", secret: c.token, username: c.username ?? null }
  } catch {}
  return null
}

export const LEGACY_NAME: Record<Provider, string> = { github: "GitHub", gitlab: "GitLab", gitea: "Gitea", git: "Git token", ssh: "SSH key" }
