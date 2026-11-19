// A tiny GitHub for Git Backup e2e: the REST calls Nimbus makes plus real git smart-HTTP (git http-backend).
// Usage: node e2e/fixtures/fake-github.mjs <dir> [port]   — repos live in <dir>/<owner>/<name>.git.
// Point the app at it with GITHUB_API_URL=http://localhost:<port>. Token "bad" is rejected (401).
// POST /_test/revoke?on=1 rejects every token. POST /_test/push/<owner>/<name> adds a commit; DELETE /_test/repo/<owner>/<name> removes the repo.
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = process.argv[2]
const port = Number(process.argv[3] ?? 3990)
const base = `http://localhost:${port}`
const REPOS = [
  { owner: "octo", type: "User", name: "hello", private: false },
  { owner: "octo", type: "User", name: "secret-notes", private: true },
  { owner: "acme", type: "Organization", name: "api", private: true },
  { owner: "acme", type: "Organization", name: "old-site", private: false, archived: true },
  { owner: "octo", type: "User", name: "forked-lib", private: false, fork: true },
]
const git = (args, cwd) => execFileSync("git", args, { cwd, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } })

function commit(owner, name) {
  const bare = join(root, owner, `${name}.git`)
  if (!existsSync(bare)) {
    mkdirSync(bare, { recursive: true })
    git(["init", "--bare", "-q", "-b", "main", bare])
  }
  const w = mkdtempSync(join(tmpdir(), "fgh-"))
  git(["clone", "-q", bare, w])
  execFileSync("sh", ["-c", `date +%s%N >> log.txt`], { cwd: w })
  git(["add", "."], w)
  git(["commit", "-qm", "change"], w)
  git(["push", "-q", "origin", "HEAD:main"], w)
  rmSync(w, { recursive: true, force: true })
}
for (const r of REPOS) if (!existsSync(join(root, r.owner, `${r.name}.git`))) commit(r.owner, r.name)

const json = (res, body, status = 200, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers })
  res.end(JSON.stringify(body))
}
// The token is "bad" → rejected, whether sent as Bearer or as a Basic password.
const authed = (req) => {
  const [kind, v = ""] = (req.headers.authorization ?? "").split(" ")
  const token = /^basic$/i.test(kind) ? Buffer.from(v, "base64").toString().split(":").slice(1).join(":") : v
  return token !== "bad" && !revoked
}
// POST /_test/revoke?on=1|0 rejects every token, like an expired or revoked one.
let revoked = false

createServer((req, res) => {
  const url = new URL(req.url, base)
  const p = url.pathname
  if (p === "/_test/revoke") {
    revoked = url.searchParams.get("on") === "1"
    return json(res, { revoked })
  }
  if (p.startsWith("/_test/push/")) {
    const [, , , owner, name] = p.split("/")
    commit(owner, name)
    return json(res, { ok: true })
  }
  if (p.startsWith("/_test/repo/") && req.method === "DELETE") {
    const [, , , owner, name] = p.split("/")
    rmSync(join(root, owner, `${name}.git`), { recursive: true, force: true })
    const i = REPOS.findIndex((r) => r.owner === owner && r.name === name)
    if (i >= 0) REPOS.splice(i, 1)
    return json(res, { ok: true })
  }
  if (/\.git\//.test(p)) {
    // git smart-HTTP through git http-backend (CGI).
    if (!authed(req)) return json(res, { message: "Bad credentials" }, 401)
    const cgi = spawn("git", ["http-backend"], {
      env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: p, QUERY_STRING: url.search.slice(1), REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers["content-type"] ?? "", REMOTE_USER: "octo" },
    })
    req.pipe(cgi.stdin)
    let head = Buffer.alloc(0)
    let sent = false
    cgi.stdout.on("data", (b) => {
      if (sent) return res.write(b)
      head = Buffer.concat([head, b])
      const i = head.indexOf("\r\n\r\n")
      if (i < 0) return
      const headers = {}
      let status = 200
      for (const line of head.subarray(0, i).toString().split("\r\n")) {
        const [k, ...v] = line.split(":")
        if (k.toLowerCase() === "status") status = Number(v.join(":").trim().split(" ")[0])
        else headers[k] = v.join(":").trim()
      }
      res.writeHead(status, headers)
      res.write(head.subarray(i + 4))
      sent = true
    })
    cgi.stdout.on("end", () => res.end())
    return
  }
  if (!authed(req)) return json(res, { message: "Bad credentials" }, 401)
  if (p === "/user") return json(res, { login: "octo" }, 200, { "x-oauth-scopes": "repo, read:org", "github-authentication-token-expiration": "2027-01-01 00:00:00 UTC" })
  if (p === "/user/orgs") return json(res, url.searchParams.get("page") === "1" || !url.searchParams.get("page") ? [{ login: "acme" }] : [])
  if (p === "/user/repos") {
    if ((url.searchParams.get("page") ?? "1") !== "1") return json(res, [])
    return json(
      res,
      REPOS.map((r) => ({
        name: r.name,
        full_name: `${r.owner}/${r.name}`,
        private: r.private,
        fork: Boolean(r.fork),
        archived: Boolean(r.archived),
        pushed_at: new Date().toISOString(),
        created_at: r.createdAt ?? "2020-01-01T00:00:00Z",
        size: 12,
        clone_url: `${base}/${r.owner}/${r.name}.git`,
        default_branch: "main",
        owner: { login: r.owner, type: r.type },
      }))
    )
  }
  if (/^\/repos\/[^/]+\/[^/]+\/hooks/.test(p)) return json(res, req.method === "GET" ? [] : { id: 1 }, req.method === "POST" ? 201 : 200)
  if (p === "/_test/add") {
    REPOS.push({ owner: "acme", type: "Organization", name: url.searchParams.get("name"), private: true, createdAt: new Date().toISOString() })
    commit("acme", url.searchParams.get("name"))
    return json(res, { ok: true })
  }
  json(res, { message: "Not Found" }, 404)
}).listen(port, () => console.log(`fake github on ${base}, repos in ${root}`))
