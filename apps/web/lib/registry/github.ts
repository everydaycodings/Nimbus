// GitHub through plain fetch (no Octokit): the PAT check, the repo list, the push/create webhook and
// commit statuses. GITHUB_API_URL points tests at a fake.
import { createHmac, timingSafeEqual } from "node:crypto"

const API = () => (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "")

export class GithubError extends Error {}

async function gh<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API()}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "nimbus-registry",
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new GithubError("Couldn't reach GitHub.")
  }
  if (res.status === 204) return undefined as T
  if (res.ok) return (await res.json()) as T
  const msg = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? res.statusText
  if (res.status === 401) throw new GithubError("GitHub didn't accept that token.")
  if (res.status === 404) throw new GithubError("GitHub can't find that repository with this token. It needs access to it.")
  if (res.status === 403 || res.status === 422) throw new GithubError(`GitHub refused: ${msg}`)
  throw new GithubError(`GitHub answered ${res.status}: ${msg}`)
}

export type GhRepo = { fullName: string; private: boolean; defaultBranch: string }
type Raw = { full_name: string; private: boolean; default_branch: string; permissions?: { admin?: boolean; push?: boolean } }
const repo = (r: Raw): GhRepo => ({ fullName: r.full_name, private: r.private, defaultBranch: r.default_branch })

export async function listRepos(token: string): Promise<GhRepo[]> {
  const out: GhRepo[] = []
  for (let page = 1; page <= 5; page++) {
    const rows = await gh<Raw[]>(token, "GET", `/user/repos?per_page=100&sort=pushed&page=${page}`)
    out.push(...rows.map(repo))
    if (rows.length < 100) break
  }
  return out
}

export async function getRepo(token: string, fullName: string) {
  const r = await gh<Raw>(token, "GET", `/repos/${fullName}`)
  return { ...repo(r), admin: Boolean(r.permissions?.admin) }
}

// push covers branches and tags; create covers a new tag made in the web UI.
export async function createHook(token: string, fullName: string, url: string, secret: string): Promise<number> {
  const r = await gh<{ id: number }>(token, "POST", `/repos/${fullName}/hooks`, {
    name: "web",
    active: true,
    events: ["push", "create"],
    config: { url, content_type: "json", secret, insecure_ssl: "0" },
  })
  return r.id
}

export async function deleteHook(token: string, fullName: string, id: number) {
  await gh(token, "DELETE", `/repos/${fullName}/hooks/${id}`)
}

export async function postStatus(token: string, fullName: string, sha: string, s: { state: "pending" | "success" | "failure" | "error"; url: string; description: string }) {
  await gh(token, "POST", `/repos/${fullName}/statuses/${sha}`, { state: s.state, target_url: s.url, description: s.description.slice(0, 140), context: "nimbus/build" })
}

// X-Hub-Signature-256: sha256=<hmac of the raw body>
export function verifySignature(secret: string, raw: string, header: string | null) {
  if (!header) return false
  const want = Buffer.from(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`)
  const got = Buffer.from(header)
  return got.length === want.length && timingSafeEqual(got, want)
}

// A GitHub "owner/name" as typed (also accepts a github.com URL).
export function parseFullName(s: string): string | null {
  const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(s.trim())
  return m ? m[1] : null
}

// Who a token belongs to and when it stops working (fine-grained tokens say so in a response header).
export async function whoami(token: string): Promise<{ login: string; expiresAt: Date | null }> {
  let res: Response
  try {
    res = await fetch(`${API()}/user`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "nimbus-registry" },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new GithubError("Couldn't reach GitHub.")
  }
  if (res.status === 401) throw new GithubError("GitHub didn't accept that token.")
  if (!res.ok) throw new GithubError(`GitHub answered ${res.status}.`)
  const login = ((await res.json().catch(() => ({}))) as { login?: string }).login
  if (!login) throw new GithubError("GitHub didn't say whose token this is.")
  // "2026-12-01 10:00:00 UTC"
  const exp = res.headers.get("github-authentication-token-expiration")
  const at = exp ? new Date(exp.replace(" UTC", "Z").replace(" ", "T")) : null
  return { login, expiresAt: at && !Number.isNaN(at.getTime()) ? at : null }
}
