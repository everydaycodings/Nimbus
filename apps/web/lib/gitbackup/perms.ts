// What a token may do, judged per host: pure helpers (no I/O, runs under plain node in runner.check.ts).
// ok: true granted, false missing, null the host can't tell. required: Nimbus can't back up without it.
// Names match the ones components/gitbackup/providers.tsx shows, so the UI can say why each is needed.
export type Perm = { name: string; ok: boolean | null; required: boolean; why?: string }
export type Access = { perms: Perm[]; fix?: string; note?: string }

const has = (scopes: string[], ...names: string[]) => names.some((n) => scopes.includes(n))
const list = (names: string[]) => names.join(", ")
const missing = (perms: Perm[], required: boolean) => perms.filter((p) => p.ok === false && p.required === required).map((p) => p.name)
// The fix text only when something is plainly missing: the required ones to add, the optional (push) one said apart.
const fixFor = (perms: Perm[], text: (names: string) => string) => {
  const [need, push] = [missing(perms, true), missing(perms, false)]
  if (need.length) return text(list(need) + (push.length ? ` (and ${list(push)} if you want backups on push)` : ""))
  if (push.length) return `For backups on push: ${text(list(push))}`
}

// Classic tokens say their scopes in X-OAuth-Scopes. repo covers reading; org repos need read:org (write:org and admin:org include it).
export function githubPerms(scopes: string[]): Perm[] {
  return [
    { name: "repo", ok: has(scopes, "repo"), required: true },
    { name: "read:org", ok: has(scopes, "read:org", "write:org", "admin:org"), required: true },
    { name: "admin:repo_hook", ok: has(scopes, "admin:repo_hook", "write:repo_hook"), required: false },
  ]
}
export const githubFix = (perms: Perm[]) =>
  fixFor(perms, (n) => `On GitHub open Settings → Developer settings → Personal access tokens (classic), open this token, tick ${n}, and Update token — the token itself stays the same.`)

// api includes read_api and read_repository.
export function gitlabPerms(scopes: string[]): Perm[] {
  return [
    { name: "read_api", ok: has(scopes, "read_api", "api"), required: true },
    { name: "read_repository", ok: has(scopes, "read_repository", "api"), required: true },
    { name: "api", ok: has(scopes, "api"), required: false },
  ]
}
export const gitlabFix = (perms: Perm[]) => fixFor(perms, (n) => `GitLab can't change an existing token's scopes, so create a new token with ${n} and paste it here.`)

// Gitea and Forgejo: the HTTP status of one probe per permission. 403 is missing; 200 granted (older servers without scoped tokens say 200 too).
export type Probe = number | null
export function giteaPerms(p: { user: Probe; orgs: Probe; repos: Probe }): Perm[] {
  const ok = (s: Probe) => (s === 403 ? false : s !== null && s >= 200 && s < 300 ? true : null)
  return [
    { name: "user: Read", ok: ok(p.user), required: true },
    { name: "organization: Read", ok: ok(p.orgs), required: true },
    { name: "repository: Read", ok: ok(p.repos), required: true },
    // Needs a write to find out, which a check must not do.
    { name: "repository: Read and Write", ok: null, required: false },
  ]
}
export const giteaFix = (perms: Perm[]) => fixFor(perms, (n) => `Tokens can't be edited, so generate a new one under Settings → Applications with ${n} and paste it here.`)

export const FINE_FIX_REPOS = "The token can't see any repos. On GitHub open Settings → Developer settings → Personal access tokens → Fine-grained tokens, set Resource owner to the account or organization that owns the repos, and Repository access to All repositories."
export const FINE_FIX_CONTENTS = "The token sees repos but can't read their code. Open it on GitHub and grant Contents: Read-only under Repository permissions."

// The checklist when nothing could be judged (rate limit, network): every permission "can't tell", plus why.
export const unknownPerms = (perms: Perm[], note: string): Access => ({ perms: perms.map((p) => ({ ...p, ok: null })), note })

// Blocks a save: a required permission is plainly missing. null never blocks.
export const blocked = (a: Access) => a.perms.filter((p) => p.required && p.ok === false)
