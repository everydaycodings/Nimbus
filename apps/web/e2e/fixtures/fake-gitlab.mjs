// A tiny GitLab for Git Backup e2e: the /api/v4 calls Nimbus makes plus real git smart-HTTP (git http-backend).
// Usage: node e2e/fixtures/fake-gitlab.mjs <dir> [port]   — repos live in <dir>/<full path>.git. Point a connection's server URL at http://localhost:<port>.
// Token "bad" is rejected (401). POST /_test/revoke?on=1 rejects every token. POST /_test/push/<full/path> adds a commit.
// Projects are served 3 per page (x-next-page) so paging gets exercised. Hooks: POST /api/v4/projects/<id>/hooks keeps url+token;
// POST /_test/deliver/<full/path> sends a push event with the hook's token (?bad=1 sends a wrong one).
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = process.argv[2]
const port = Number(process.argv[3] ?? 3992)
const base = `http://localhost:${port}`
const PROJECTS = [
  { ns: "octo", kind: "user", path: "hello", visibility: "public" },
  { ns: "octo", kind: "user", path: "secret-notes", visibility: "private" },
  { ns: "acme", kind: "group", path: "api", visibility: "private" },
  { ns: "acme/platform", kind: "group", path: "infra", visibility: "private" },
  { ns: "octo", kind: "user", path: "forked", visibility: "public", fork: true },
]
const git = (args, cwd) => execFileSync("git", args, { cwd, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } })

function commit(full) {
  const bare = join(root, `${full}.git`)
  if (!existsSync(bare)) {
    mkdirSync(bare, { recursive: true })
    git(["init", "--bare", "-q", "-b", "main", bare])
  }
  const w = mkdtempSync(join(tmpdir(), "fgl-"))
  git(["clone", "-q", bare, w])
  execFileSync("sh", ["-c", "date +%s%N >> log.txt"], { cwd: w })
  git(["add", "."], w)
  git(["commit", "-qm", "change"], w)
  git(["push", "-q", "origin", "HEAD:main"], w)
  rmSync(w, { recursive: true, force: true })
}
for (const p of PROJECTS) if (!existsSync(join(root, `${p.ns}/${p.path}.git`))) commit(`${p.ns}/${p.path}`)

let revoked = false
const hooks = new Map() // full path -> [{ id, url, token }]
let hookId = 0
const json = (res, body, status = 200, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers })
  res.end(JSON.stringify(body))
}
const readBody = async (req) => {
  const c = []
  for await (const b of req) c.push(b)
  return Buffer.concat(c)
}
// "PRIVATE-TOKEN: <t>" for the API, Basic oauth2:<t> for git.
const authed = (req) => {
  const [kind, v = ""] = (req.headers.authorization ?? "").split(" ")
  const token = /^basic$/i.test(kind) ? Buffer.from(v, "base64").toString().split(":").slice(1).join(":") : req.headers["private-token"]
  return Boolean(token) && token !== "bad" && !revoked
}
const project = (p) => ({
  id: PROJECTS.indexOf(p) + 1,
  path: p.path,
  path_with_namespace: `${p.ns}/${p.path}`,
  visibility: p.visibility,
  archived: false,
  forked_from_project: p.fork ? { id: 99 } : undefined,
  last_activity_at: new Date().toISOString(),
  created_at: p.createdAt ?? "2020-01-01T00:00:00Z",
  default_branch: "main",
  http_url_to_repo: `${base}/${p.ns}/${p.path}.git`,
  statistics: { repository_size: 4096 },
  namespace: { full_path: p.ns, kind: p.kind },
})

createServer((req, res) => {
  const url = new URL(req.url, base)
  const p = url.pathname
  if (p === "/_test/revoke") {
    revoked = url.searchParams.get("on") === "1"
    return json(res, { revoked })
  }
  if (p.startsWith("/_test/push/")) return commit(p.slice(12)), json(res, { ok: true })
  if (p.startsWith("/_test/deliver/")) {
    const full = p.slice(15)
    const hook = (hooks.get(full) ?? [])[0]
    if (!hook) return json(res, { error: "no hook" }, 404)
    const body = JSON.stringify({ object_kind: "push", ref: "refs/heads/main", project: { path_with_namespace: full } })
    return fetch(hook.url.replace("host.docker.internal", "localhost"), { method: "POST", headers: { "content-type": "application/json", "x-gitlab-event": "Push Hook", "x-gitlab-token": url.searchParams.get("bad") ? "wrong" : hook.token }, body }).then(async (r) => json(res, { status: r.status, body: await r.text() }), (e) => json(res, { error: String(e) }, 502))
  }
  if (/\.git\//.test(p)) {
    if (!authed(req)) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="GitLab"' })
      return res.end()
    }
    const cgi = spawn("git", ["http-backend"], { env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: p, QUERY_STRING: url.search.slice(1), REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers["content-type"] ?? "", REMOTE_USER: "octo" } })
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
  if (!p.startsWith("/api/v4/")) return json(res, { message: "404 Not Found" }, 404)
  if (!authed(req)) return json(res, { message: "401 Unauthorized" }, 401)
  const a = p.slice(7)
  if (a === "/user") return json(res, { username: "octo" })
  if (a === "/personal_access_tokens/self") return json(res, { scopes: ["read_api", "read_repository", "api"], expires_at: "2027-02-01" })
  if (a === "/groups") return json(res, [{ full_path: "acme" }, { full_path: "acme/platform" }])
  if (a === "/projects") {
    const page = Number(url.searchParams.get("page") ?? 1)
    const rows = PROJECTS.slice((page - 1) * 3, page * 3).map(project)
    return json(res, rows, 200, page * 3 < PROJECTS.length ? { "x-next-page": String(page + 1) } : { "x-next-page": "" })
  }
  const hk = /^\/projects\/([^/]+)\/hooks(?:\/(\d+))?$/.exec(a)
  if (hk) {
    const full = decodeURIComponent(hk[1])
    const list = hooks.get(full) ?? []
    if (req.method === "POST") return readBody(req).then((b) => (hooks.set(full, [...list, { id: ++hookId, ...JSON.parse(b.toString()) }]), json(res, { id: hookId }, 201)))
    if (req.method === "DELETE") return hooks.set(full, list.filter((h) => String(h.id) !== hk[2])), json(res, {}, 204)
    return json(res, list)
  }
  json(res, { message: "404 Not Found" }, 404)
}).listen(port, () => console.log(`fake gitlab on ${base}, repos in ${root}`))
