// Self-check for Git Backup: node lib/gitbackup/runner.check.ts (needs git and tar).
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { createReadStream } from "node:fs"

import { catFile, extract, headInfo, lsRemote, lsTree, mirror, pack, refNames, sealBare } from "./archive.ts"
import { failureKind, hashRefs, inScope, manifestKey, parseRefs, pickPrune, snapshotKey } from "./refs.ts"

// --- pure parts
const out = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v1\n"
const refs = parseRefs(out)
assert.deepEqual(Object.keys(refs), ["refs/heads/main", "refs/tags/v1"])
assert.equal(hashRefs(refs), hashRefs(parseRefs(out.split("\n").reverse().join("\n"))))
assert.notEqual(hashRefs(refs), hashRefs({ ...refs, "refs/heads/main": "c".repeat(40) }))
assert.notEqual(hashRefs(refs), hashRefs({ "refs/heads/main": refs["refs/heads/main"] }))

const d = (n: number) => ({ id: String(n), createdAt: new Date(2026, 0, n) })
const snaps = [d(3), d(1), d(5), d(2), d(4)]
assert.deepEqual(pickPrune(snaps, 3).map((s) => s.id).sort(), ["1", "2"])
assert.equal(pickPrune(snaps, 10).length, 0)
assert.equal(pickPrune(snaps, 0).length, 4) // always keeps the newest

// Scope: "*" all, "login" the whole owner, "login@t" only repos made after t (unknown time: not new).
const t = Date.parse("2026-11-01T00:00:00Z") / 1000
assert.ok(inScope(["*"], { owner: "x" }))
assert.ok(inScope(["Acme"], { owner: "acme", createdAt: "2001-01-01T00:00:00Z" }))
assert.ok(!inScope(["acme"], { owner: "octo" }))
assert.ok(!inScope([`acme@${t}`], { owner: "acme", createdAt: "2026-10-31T00:00:00Z" }))
assert.ok(inScope([`acme@${t}`], { owner: "ACME", createdAt: "2026-11-02T00:00:00Z" }))
assert.ok(!inScope([`acme@${t}`], { owner: "acme", createdAt: null }))

const key = snapshotKey("git-backup/", "github.com", "acme", "app", new Date("2026-11-19T04:05:06Z"), "0123456789abcdef")
assert.equal(key, "git-backup/github.com/acme/app/20261119T040506Z-0123456.tar.gz")
assert.equal(manifestKey(key), "git-backup/github.com/acme/app/20261119T040506Z-0123456.manifest.json")
assert.equal(snapshotKey("/a//b/", "h", "o", "r", new Date("2026-11-19T04:05:06Z"), "0123456"), "a/b/h/o/r/20261119T040506Z-0123456.tar.gz")
// A dead token is "auth", never "missing" on its own; the runner checks the token before calling a repo gone.
assert.equal(failureKind("git ls-remote failed: remote: Repository not found."), "missing")
assert.equal(failureKind("fatal: Authentication failed for 'https://github.com/a/b.git/'"), "auth")
assert.equal(failureKind("git ls-remote failed: fatal: repository 'https://h/o/r.git/' not found"), "missing")
assert.equal(failureKind("fatal: unable to access 'https://github.com/a/b.git/': The requested URL returned error: 403"), "auth")
assert.equal(failureKind("remote: Invalid username or token. Password authentication is not supported"), "auth")
assert.equal(failureKind("git-lfs: command not found"), null)

// --- against a local repo over file://
const base = mkdtempSync(join(tmpdir(), "gbcheck-"))
const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8" })
const src = join(base, "src.git")
const work = join(base, "work")
g(base, "init", "--bare", "-b", "main", src)
g(base, "clone", src, work)
writeFileSync(join(work, "a.txt"), "hello\n")
writeFileSync(join(work, "bin.dat"), Buffer.from([0, 1, 2]))
g(work, "add", "."), g(work, "commit", "-m", "one"), g(work, "tag", "v1"), g(work, "push", "origin", "main", "v1")
const auth = { protocols: "file" }
const url = `file://${src}`

const r1 = await lsRemote(url, auth)
assert.deepEqual(Object.keys(r1).sort(), ["refs/heads/main", "refs/tags/v1"])
assert.equal(hashRefs(r1), hashRefs(await lsRemote(url, auth)), "unchanged repo, same hash")
writeFileSync(join(work, "b.txt"), "two\n")
g(work, "add", "."), g(work, "commit", "-m", "two"), g(work, "push", "origin", "main")
const r2 = await lsRemote(url, auth)
assert.notEqual(hashRefs(r1), hashRefs(r2), "a moved branch changes the hash")

// Errors never carry the token.
const secret = "ghp_SECRETTOKEN123"
await assert.rejects(lsRemote("https://127.0.0.1:1/x/y.git", { token: secret }), (e: Error) => {
  assert.ok(!e.message.includes(secret) && !e.message.includes(Buffer.from(`x-access-token:${secret}`).toString("base64")), e.message)
  return true
})

// Mirror, pack, restore.
const dir = join(base, "run", "app.git")
await mirror(url, dir, auth)
const head = await headInfo(dir)
assert.equal(head.defaultBranch, "main")
assert.equal(head.sha, g(work, "rev-parse", "HEAD").trim())
const tgz = join(base, "app.tar.gz")
const tar = pack(join(base, "run"), "app.git", () => {})
await pipeline(tar.body, createWriteStream(tgz))
await tar.done
assert.equal(tar.size(), readFileSync(tgz).length)

const rest = join(base, "restore")
await extract(createReadStream(tgz), rest)
const clone = join(base, "clone")
g(base, "clone", join(rest, "app.git"), clone)
assert.equal(g(clone, "rev-parse", "HEAD").trim(), head.sha)
assert.equal(g(rest + "/app.git", "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/tags"), g(src, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads", "refs/tags"))

// Browse (sealed first, as the runner does: no hooks, own config, no links).
const bare = join(rest, "app.git")
mkdirSync(join(bare, "hooks"), { recursive: true })
writeFileSync(join(bare, "hooks", "pre-push"), "#!/bin/sh\nexit 1\n")
writeFileSync(join(bare, "config"), "[core]\n\tbare = true\n\tsshCommand = touch /tmp/pwned\n")
await sealBare(bare)
assert.ok(!existsSync(join(bare, "hooks")) && !readFileSync(join(bare, "config"), "utf8").includes("sshCommand"))
const evil = join(base, "evil.git")
mkdirSync(evil)
symlinkSync("/etc", join(evil, "objects"))
await assert.rejects(sealBare(evil), /links/)
assert.deepEqual(await refNames(bare), ["refs/heads/main", "refs/tags/v1"])
assert.deepEqual((await lsTree(bare, "main", "")).map((e) => e.path), ["a.txt", "b.txt", "bin.dat"])
const f = await catFile(bare, "main", "a.txt", 1024)
assert.equal(f.body.toString(), "hello\n")
assert.equal((await catFile(bare, "main", "bin.dat", 1024)).body.includes(0), true)
assert.equal((await catFile(bare, "main", "a.txt", 3)).body.length, 3)

console.log("gitbackup checks passed")
