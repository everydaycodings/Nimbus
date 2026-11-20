import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { fingerprint, forgetArgs, newKeyPair, parseBackupLine, pathsTar, pickHostKey, repoUrl, shq, sourceFile, sourceOfFile, tarEntries } from "./rules.ts"

test("the generated key is a real OpenSSH key", () => {
  const k = newKeyPair()
  const dir = mkdtempSync(join(tmpdir(), "sb-"))
  const f = join(dir, "id")
  writeFileSync(f, k.privateKey)
  chmodSync(f, 0o600)
  const pub = execFileSync("ssh-keygen", ["-y", "-f", f]).toString().trim()
  assert.equal(pub.split(" ")[1], k.publicKey.split(" ")[1])
})

test("quoting, remote commands, restic arguments", () => {
  assert.equal(shq("it's"), `'it'\\''s'`)
  assert.match(pathsTar(["/etc", "/a b"], ["*.log"]), /^tar -cf - --exclude='\*\.log' '\/etc' '\/a b'; r=\$\?/)
  assert.equal(sourceOfFile("/volume-db_data.tar"), "volume:db_data")
  assert.equal(sourceFile("paths"), "paths.tar")
  assert.equal(repoUrl({ s3Endpoint: "http://m:9000/", s3Region: "", s3Bucket: "b", s3PathStyle: true, prefix: "/p/" }), "s3:http://m:9000/b/p")
  assert.deepEqual(forgetArgs({ daily: 7, weekly: 4, monthly: 12 }), ["--keep-daily", "7", "--keep-weekly", "4", "--keep-monthly", "12"])
  assert.equal(pickHostKey("# h\nh ssh-rsa AAA\nh ssh-ed25519 BBB\n"), "ssh-ed25519 BBB")
  assert.match(fingerprint("ssh-ed25519 AAAA"), /^SHA256:/)
  assert.deepEqual(parseBackupLine('{"message_type":"summary","snapshot_id":"abc","data_added":5,"total_files_processed":2,"total_bytes_processed":9}'), { kind: "summary", snapshotId: "abc", added: 5, files: 2, bytes: 9 })
  assert.equal(parseBackupLine("restic: boom"), null)
})

test("the tar reader lists and reads what GNU tar wrote, long names included", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-"))
  const deep = join(dir, "src", "d".repeat(120), "e".repeat(120))
  mkdirSync(deep, { recursive: true })
  writeFileSync(join(deep, "big.txt"), "x".repeat(1500))
  writeFileSync(join(dir, "src", "small.txt"), "hello")
  const p = spawn("tar", ["-cf", "-", "-C", dir, "src"], { stdio: ["ignore", "pipe", "inherit"] })
  const seen: Record<string, string> = {}
  for await (const e of tarEntries(p.stdout)) {
    if (e.type !== "file") {
      seen[e.name] = "<dir>"
      continue
    }
    let s = ""
    for await (const c of e.data()) s += c.toString()
    seen[e.name] = s
  }
  assert.equal(seen["src/small.txt"], "hello")
  assert.equal(seen[`src/${"d".repeat(120)}/${"e".repeat(120)}/big.txt`], "x".repeat(1500))
  assert.equal(seen["src"], "<dir>")
})
