// Pure helpers for Git Backup: ref lists and their hash, retention, object keys. No imports: runs under plain node.
import { createHash, createHmac, timingSafeEqual } from "node:crypto"

// `git ls-remote --refs` output: "<sha>\t<ref>" per line.
export function parseRefs(out: string): Record<string, string> {
  const refs: Record<string, string> = {}
  for (const line of out.split("\n")) {
    const m = /^([0-9a-f]{40,64})\s+(\S+)$/.exec(line.trim())
    if (m) refs[m[2]] = m[1]
  }
  return refs
}

// Same refs in any order give the same hash.
export const hashRefs = (refs: Record<string, string>) =>
  createHash("sha256")
    .update(
      Object.keys(refs)
        .sort()
        .map((r) => `${refs[r]} ${r}`)
        .join("\n")
    )
    .digest("hex")

// The oldest snapshots beyond `keep`. Never more than all but one: keep is at least 1.
export function pickPrune<T extends { createdAt: Date }>(snaps: T[], keep: number): T[] {
  return [...snaps].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(Math.max(keep, 1))
}

export const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z"

// <prefix>/<host>/<owner>/<repo>/<YYYYMMDDTHHmmssZ>-<sha7>.tar.gz
export const snapshotKey = (prefix: string, host: string, owner: string, repo: string, when: Date, sha: string) =>
  [...prefix.split("/"), host, owner, repo, `${stamp(when)}-${sha.slice(0, 7)}.tar.gz`].filter(Boolean).join("/")

export const manifestKey = (key: string) => key.replace(/\.tar\.gz$/, ".manifest.json")

// What a failed git call says about access: "auth" (the token was refused), "missing" (no such repo, or not
// visible to this token: GitHub says 404 for both), null (anything else). The runner checks the token before
// calling a repo gone, since a dead token can look like either.
export const failureKind = (msg: string): "auth" | "missing" | null =>
  /repository not found|repository .{1,300} not found|returned error: 404/i.test(msg) ? "missing" : /authentication failed|invalid username or (password|token)|could not read username|returned error: 40[13]/i.test(msg) ? "auth" : null

// A job's stored scope (gitBackupJobs.autoOwners) entry: "*" every repo the token sees, "login" every repo of that owner,
// "login@<unix seconds>" only that owner's repos created after then ("Choose repos" plus new ones from an owner).
export function scopeRule(entry: string): { owner: string; since: number | null } {
  const [owner, t] = entry.toLowerCase().split("@")
  return { owner, since: t ? Number(t) * 1000 : null }
}

// Does a repo the token lists fall in the scope? An owner covers its GitLab subgroups too ("acme" takes acme/platform/infra,
// not acme2). An unknown creation time never counts as new.
export const inScope = (entries: string[], r: { owner: string; createdAt?: string | null }) => {
  const o = r.owner.toLowerCase()
  return entries.map(scopeRule).some(({ owner, since }) => (owner === "*" || owner === o || o.startsWith(`${owner}/`)) && (since === null || (r.createdAt ? Date.parse(r.createdAt) > since : false)))
}

// ---- git hosts (pure: used by the runner, the webhook route and the self-check)

export type Provider = "github" | "gitlab" | "gitea" | "forgejo"

// The user name git sends with a token over HTTP Basic: GitHub takes anything, GitLab wants oauth2, Gitea and Forgejo want the login.
export const gitUser = (provider: Provider, account?: string | null) => (provider === "gitlab" ? "oauth2" : provider === "github" || !account ? "x-access-token" : account)

// The stored host: null for the provider's cloud, "host[:port]" otherwise, "http://host[:port]" when typed as http (only allowed
// where an admin allows private addresses, checked on every call). Gitea and Forgejo have no cloud, so they need one.
export function cleanHost(provider: Provider, input: string | null | undefined): { host: string | null } | { error: string } {
  const raw = (input ?? "").trim().toLowerCase()
  const http = raw.startsWith("http://")
  const s = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
  if (!s && (provider === "gitea" || provider === "forgejo")) return { error: "Enter the server address, like git.example.com." }
  if (!s || (!http && (provider === "github" || provider === "gitlab") && s === `${provider}.com`)) return { host: null }
  return /^[a-z0-9.-]+(:\d{1,5})?$/.test(s) ? { host: http ? `http://${s}` : s } : { error: "Enter the server address like git.example.com." }
}

// "https://git.example.com" (or http://) for a stored host.
export const hostBase = (host: string) => (/^https?:\/\//.test(host) ? host : `https://${host}`)

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

// Does a push delivery come from the host the job's secret was given to? GitHub: sha256=<hmac> in X-Hub-Signature-256;
// Gitea and Forgejo: bare hex hmac in X-Gitea-Signature / X-Forgejo-Signature; GitLab: the secret itself in X-Gitlab-Token.
export function hookOk(provider: Provider, secret: string, raw: string, h: (name: string) => string | null): boolean {
  const mac = createHmac("sha256", secret).update(raw).digest("hex")
  if (provider === "gitlab") return same(h("x-gitlab-token") ?? "", secret)
  if (provider === "github") return same(h("x-hub-signature-256") ?? "", `sha256=${mac}`)
  return same(h(`x-${provider}-signature`) ?? h("x-gitea-signature") ?? "", mac)
}

// "owner/name" a push delivery is about ("group/sub/repo" on GitLab: the owner is everything before the last slash).
export function hookRepo(provider: Provider, body: unknown): { owner: string; name: string } | null {
  const b = body as { repository?: { full_name?: string }; project?: { path_with_namespace?: string } } | null
  const full = (provider === "gitlab" ? b?.project?.path_with_namespace : b?.repository?.full_name) ?? ""
  const i = full.lastIndexOf("/")
  return i > 0 && i < full.length - 1 ? { owner: full.slice(0, i), name: full.slice(i + 1) } : null
}
