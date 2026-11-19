// A tiny GitHub for Git Backup e2e: the REST calls Nimbus makes plus real git smart-HTTP (git http-backend).
// Usage: node e2e/fixtures/fake-github.mjs <dir> [port]   — repos live in <dir>/<owner>/<name>.git.
// Point the app at it with GITHUB_API_URL=http://localhost:<port>. Token "bad" is rejected (401).
// POST /_test/revoke?on=1 rejects every token. POST /_test/push/<owner>/<name> adds a commit; DELETE /_test/repo/<owner>/<name> removes the repo.
// OAuth: GET /login/oauth/authorize redirects back with code+state; POST /login/oauth/access_token answers a token.
// Webhooks: POST /repos/<o>/<r>/hooks keeps url+secret; POST /_test/deliver/<o>/<r> sends a signed push event to it.
// LFS: GET /_test/lfs?name=<n> makes acme/<n> with a pointer file; the batch API and object store are at <repo>.git/info/lfs and /_lfs/<oid>.
import { createHash, createHmac } from "node:crypto"
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
const tokenOf = (req) => {
  const [kind, v = ""] = (req.headers.authorization ?? "").split(" ")
  return /^basic$/i.test(kind) ? Buffer.from(v, "base64").toString().split(":").slice(1).join(":") : v
}
const authed = (req) => tokenOf(req) !== "bad" && !revoked
const scopesOf = (token) => {
  if (token.includes("fine")) return null
  return ["repo", token.includes("writeorg") ? "write:org" : "read:org", "admin:repo_hook"].filter((s) => !(token.includes("norepo") && s === "repo") && !(token.includes("noorg") && (s === "read:org" || s === "write:org")) && !(token.includes("nohook") && s === "admin:repo_hook")).join(", ")
}
const hooks = new Map() // "owner/name" -> { url, secret }
const removed = new Map() // deleted hooks, so ?stale=1 can still deliver to one (a hook GitHub kept sending after Nimbus turned it off)
const lfsObjects = new Map() // oid -> Buffer
const readBody = async (req) => {
  const c = []
  for await (const b of req) c.push(b)
  return Buffer.concat(c)
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
  if (p === "/login/oauth/authorize") {
    const to = new URL(url.searchParams.get("redirect_uri"))
    to.searchParams.set("code", "fakecode")
    to.searchParams.set("state", url.searchParams.get("state") ?? "")
    res.writeHead(302, { location: to.toString() })
    return res.end()
  }
  if (p === "/login/oauth/access_token") {
    return readBody(req).then((b) => json(res, JSON.parse(b.toString() || "{}").code === "fakecode" ? { access_token: "gho_fake1234567890" } : { error: "bad_verification_code" }))
  }
  if (p.startsWith("/_test/deliver/")) {
    const [, , , owner, name] = p.split("/")
    const hook = hooks.get(`${owner}/${name}`) ?? (url.searchParams.get("stale") ? removed.get(`${owner}/${name}`) : undefined)
    if (!hook) return json(res, { error: "no hook" }, 404)
    const body = JSON.stringify({ ref: "refs/heads/main", repository: { full_name: `${owner}/${name}` } })
    const sig = url.searchParams.get("bad") ? "sha256=00" : `sha256=${createHmac("sha256", hook.secret).update(body).digest("hex")}`
    return fetch(hook.url.replace("host.docker.internal", "localhost"), { method: "POST", headers: { "content-type": "application/json", "x-github-event": url.searchParams.get("event") ?? "push", "x-hub-signature-256": sig }, body }).then(async (r) => json(res, { status: r.status, body: await r.text() }), (e) => json(res, { error: String(e) }, 502))
  }
  if (p === "/_test/lfs") {
    const name = url.searchParams.get("name")
    const content = Buffer.from(`real lfs content ${name}\n`.repeat(50))
    const oid = createHash("sha256").update(content).digest("hex")
    lfsObjects.set(oid, content)
    const bare = join(root, "acme", `${name}.git`)
    mkdirSync(bare, { recursive: true })
    git(["init", "--bare", "-q", "-b", "main", bare])
    const w = mkdtempSync(join(tmpdir(), "fgh-"))
    git(["clone", "-q", bare, w])
    execFileSync("sh", ["-c", `echo '*.bin filter=lfs diff=lfs merge=lfs -text' > .gitattributes; printf 'version https://git-lfs.github.com/spec/v1\\noid sha256:${oid}\\nsize ${content.length}\\n' > big.bin`], { cwd: w })
    git(["add", "."], w)
    git(["commit", "-qm", "lfs"], w)
    git(["push", "-q", "origin", "HEAD:main"], w)
    rmSync(w, { recursive: true, force: true })
    REPOS.push({ owner: "acme", type: "Organization", name, private: true, createdAt: new Date().toISOString() })
    return json(res, { oid, size: content.length })
  }
  if (p.startsWith("/_lfs/")) {
    const oid = p.slice(6)
    if (req.method === "PUT") return readBody(req).then((b) => (lfsObjects.set(oid, b), res.writeHead(200).end()))
    return lfsObjects.has(oid) ? res.writeHead(200).end(lfsObjects.get(oid)) : json(res, { message: "Not Found" }, 404)
  }
  if (/\.git\/info\/lfs\/objects\/batch$/.test(p) && req.method === "POST") {
    if (!authed(req)) return json(res, { message: "Bad credentials" }, 401)
    return readBody(req).then((b) => {
      const { operation, objects } = JSON.parse(b.toString())
      const act = operation === "upload" ? "upload" : "download"
      json(
        res,
        {
          transfer: "basic",
          objects: objects.map((o) =>
            act === "download" && !lfsObjects.has(o.oid) ? { oid: o.oid, size: o.size, error: { code: 404, message: "not found" } } : act === "upload" && lfsObjects.has(o.oid) ? { oid: o.oid, size: o.size } : { oid: o.oid, size: o.size, actions: { [act]: { href: `${base}/_lfs/${o.oid}` } } }
          ),
        },
        200,
        { "content-type": "application/vnd.git-lfs+json" }
      )
    })
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
  if (p === "/user") {
    const scopes = scopesOf(tokenOf(req))
    return json(res, { login: "octo" }, 200, { ...(scopes === null ? {} : { "x-oauth-scopes": scopes }), "github-authentication-token-expiration": "2027-01-01 00:00:00 UTC" })
  }
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
  const hk = /^\/repos\/([^/]+\/[^/]+)\/hooks/.exec(p)
  if (hk) {
    if (req.method === "POST") return readBody(req).then((b) => (hooks.set(hk[1], JSON.parse(b.toString()).config), json(res, { id: 1 }, 201)))
    if (req.method === "DELETE") return removed.set(hk[1], hooks.get(hk[1])), hooks.delete(hk[1]), json(res, {}, 204)
    const h = hooks.get(hk[1])
    return json(res, h ? [{ id: 1, config: { url: h.url } }] : [])
  }
  if (p === "/_test/add") {
    REPOS.push({ owner: "acme", type: "Organization", name: url.searchParams.get("name"), private: true, createdAt: new Date().toISOString() })
    commit("acme", url.searchParams.get("name"))
    return json(res, { ok: true })
  }
  json(res, { message: "Not Found" }, 404)
}).listen(port, () => console.log(`fake github on ${base}, repos in ${root}`))
