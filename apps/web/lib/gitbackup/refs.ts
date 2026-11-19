// Pure helpers for Git Backup: ref lists and their hash, retention, object keys. No imports: runs under plain node.
import { createHash } from "node:crypto"

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

// Does a repo the token lists fall in the scope? An unknown creation time never counts as new.
export const inScope = (entries: string[], r: { owner: string; createdAt?: string | null }) =>
  entries.map(scopeRule).some(({ owner, since }) => (owner === "*" || owner === r.owner.toLowerCase()) && (since === null || (r.createdAt ? Date.parse(r.createdAt) > since : false)))
