// Pure helpers for Server Backup: the SSH key, shell quoting, the remote commands, restic's arguments and output, and a
// small tar reader. Relative imports only: rules.test.ts runs this under plain node.
import { createHash, generateKeyPairSync } from "node:crypto"

// ---- the SSH key --------------------------------------------------------------------------------------------

const str = (b: Uint8Array | string) => {
  const d = typeof b === "string" ? Buffer.from(b) : Buffer.from(b)
  const n = Buffer.alloc(4)
  n.writeUInt32BE(d.length)
  return Buffer.concat([n, d])
}
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

// A new ed25519 key as an unencrypted OpenSSH private key (what `ssh -i` and ssh-keygen read) and its authorized_keys line.
export function newKeyPair(comment = "nimbus-server-backup") {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url")
  const seed = Buffer.from(privateKey.export({ format: "jwk" }).d!, "base64url")
  const blob = Buffer.concat([str("ssh-ed25519"), str(pub)])
  const check = Buffer.alloc(4)
  check.writeUInt32BE(Math.floor(Math.random() * 0xffffffff))
  let priv = Buffer.concat([check, check, str("ssh-ed25519"), str(pub), str(Buffer.concat([seed, pub])), str(comment)])
  const pad = (8 - (priv.length % 8)) % 8
  priv = Buffer.concat([priv, Buffer.from(Array.from({ length: pad }, (_, i) => i + 1))])
  const body = Buffer.concat([Buffer.from("openssh-key-v1\0"), str("none"), str("none"), str(""), u32(1), str(blob), str(priv)])
  const lines = body.toString("base64").match(/.{1,70}/g)!.join("\n")
  return {
    privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines}\n-----END OPENSSH PRIVATE KEY-----\n`,
    publicKey: `ssh-ed25519 ${blob.toString("base64")} ${comment}`,
  }
}

// "ssh-ed25519 AAAA…" (a host key as ssh-keyscan prints it, without the host) -> "SHA256:…" like ssh-keygen -l.
export const fingerprint = (key: string) => `SHA256:${createHash("sha256").update(Buffer.from(key.trim().split(/\s+/)[1] ?? "", "base64")).digest("base64").replace(/=+$/, "")}`

// The ssh-keyscan line to use as the stored host key: ed25519 when offered, else the first.
export function pickHostKey(scan: string): string | null {
  const keys = scan
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.trim().split(/\s+/).slice(1, 3).join(" "))
    .filter((k) => /^\S+ \S+$/.test(k))
  return keys.find((k) => k.startsWith("ssh-ed25519 ")) ?? keys[0] ?? null
}

export const knownHostsLine = (host: string, port: number, key: string) => `${port === 22 ? host : `[${host}]:${port}`} ${key}\n`

// ---- checks ---------------------------------------------------------------------------------------------------

export const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$|^[0-9a-fA-F:]+$/
export const USER_RE = /^[a-z_][a-z0-9_.-]{0,31}$/i
export const VOLUME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

// Absolute paths only, one per line; "-" starts and control characters would be read as options or break the command.
export function pathError(p: string): string | null {
  if (!p.startsWith("/")) return `“${p}” must be an absolute path (start with /).`
  if (p.length > 1000 || /[\0\n\r]/.test(p)) return `“${p.slice(0, 40)}” isn't a valid path.`
  return null
}

export const lines = (s: string) => [...new Set(s.split("\n").map((l) => l.trim()).filter(Boolean))]

// ---- remote commands -------------------------------------------------------------------------------------------

export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// tar exits 1 for "a file changed while reading": a warning, not a failed backup.
const lenient = (cmd: string) => `${cmd}; r=$?; [ $r -eq 1 ] && r=0; exit $r`

export const pathsTar = (paths: string[], excludes: string[]) => lenient(`tar -cf - ${excludes.map((e) => `--exclude=${shq(e)}`).join(" ")} ${paths.map(shq).join(" ")}`.replace(/ {2,}/g, " "))

export const volumeTar = (volume: string) => `docker run --rm -v ${shq(volume)}:/v:ro alpine tar -cf - -C /v .`
export const volumeUntar = (volume: string) => `docker run --rm -i -v ${shq(volume)}:/v alpine tar -xf - -C /v`
export const containersOf = (volume: string) => `docker ps -q --filter ${shq(`volume=${volume}`)}`

// One restic snapshot per source; the file name inside it stays the same from run to run, so restic's chunks line up.
export const sourceFile = (source: string) => (source === "paths" ? "paths.tar" : `volume-${source.slice("volume:".length)}.tar`)
export const sourceOfFile = (file: string) => {
  const n = file.replace(/^\//, "")
  return n === "paths.tar" ? "paths" : n.startsWith("volume-") && n.endsWith(".tar") ? `volume:${n.slice(7, -4)}` : null
}

// ---- restic ------------------------------------------------------------------------------------------------------

export type Retention = { daily: number; weekly: number; monthly: number }
export const DEFAULT_RETENTION: Retention = { daily: 7, weekly: 4, monthly: 12 }

export const retentionOk = (r: Retention) => [r.daily, r.weekly, r.monthly].every((n) => Number.isInteger(n) && n >= 0 && n <= 1000) && r.daily + r.weekly + r.monthly > 0
export const forgetArgs = (r: Retention) => ["--keep-daily", String(r.daily), "--keep-weekly", String(r.weekly), "--keep-monthly", String(r.monthly)]

export type RepoDest = { s3Endpoint: string; s3Region: string; s3Bucket: string; s3PathStyle: boolean; prefix: string }

export const repoUrl = (d: RepoDest) => `s3:${d.s3Endpoint.replace(/\/+$/, "")}/${d.s3Bucket}/${d.prefix.replace(/^\/+|\/+$/g, "")}`
// restic has no environment variable for these, so they go in as -o options.
export const repoOpts = (d: RepoDest) => ["-o", `s3.region=${d.s3Region || "us-east-1"}`, ...(d.s3PathStyle ? ["-o", "s3.bucket-lookup=path"] : [])]
// The same host name on every run: restic groups snapshots by it, and a container's own hostname changes.
export const resticHost = (hostId: string) => `nimbus-${hostId.slice(0, 8)}`

export type BackupLine = { kind: "status"; percent: number | null; bytes: number; files: number } | { kind: "summary"; snapshotId: string; added: number; files: number; bytes: number }

// One line of `restic backup --json`.
export function parseBackupLine(line: string): BackupLine | null {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(line)
  } catch {
    return null
  }
  if (j.message_type === "status") return { kind: "status", percent: typeof j.percent_done === "number" ? j.percent_done : null, bytes: Number(j.bytes_done ?? 0), files: Number(j.files_done ?? 0) }
  if (j.message_type === "summary" && typeof j.snapshot_id === "string")
    return { kind: "summary", snapshotId: j.snapshot_id, added: Number(j.data_added ?? 0), files: Number(j.total_files_processed ?? 0), bytes: Number(j.total_bytes_processed ?? 0) }
  return null
}

// What a person can read from restic's stderr: the last few lines, no secrets.
export const tail = (s: string, n = 4000) => (s.length > n ? s.slice(-n) : s)

// ---- tar ---------------------------------------------------------------------------------------------------------

export type TarEntry = { name: string; type: "file" | "dir" | "link"; size: number; mtime: number; data: () => AsyncGenerator<Buffer> }

class Pull {
  private it: AsyncIterator<Uint8Array>
  private buf = Buffer.alloc(0)
  private done = false
  constructor(src: AsyncIterable<Uint8Array>) {
    this.it = src[Symbol.asyncIterator]()
  }
  private async fill() {
    if (this.done) return false
    const r = await this.it.next()
    if (r.done) return (this.done = true), false
    this.buf = this.buf.length ? Buffer.concat([this.buf, r.value]) : Buffer.from(r.value)
    return true
  }
  async exact(n: number) {
    while (this.buf.length < n && (await this.fill()));
    const out = this.buf.subarray(0, n)
    this.buf = this.buf.subarray(out.length)
    return out
  }
  async *take(n: number) {
    while (n > 0) {
      if (!this.buf.length && !(await this.fill())) throw new Error("The backup ended in the middle of a file.")
      const c = this.buf.subarray(0, Math.min(n, this.buf.length))
      this.buf = this.buf.subarray(c.length)
      n -= c.length
      yield c
    }
  }
}

const cstr = (b: Buffer) => b.subarray(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)).toString("utf8")
const octal = (b: Buffer) => {
  if (b[0] & 0x80) return Number(b.readBigUInt64BE(b.length - 8) & BigInt("0x7fffffffffffffff"))
  return parseInt(cstr(b).trim() || "0", 8)
}
const drain = async (g: AsyncGenerator<Buffer>) => {
  for await (const c of g) void c
}
const collect = async (g: AsyncGenerator<Buffer>) => {
  const out: Buffer[] = []
  for await (const c of g) out.push(c)
  return Buffer.concat(out)
}

// "./a/b/" -> "a/b"; "." -> "".
export const cleanName = (n: string) => n.replace(/^(\.\/)+/, "").replace(/\/+$/, "").replace(/^\.$/, "")

// Reads a tar stream (ustar, GNU long names, pax headers). Each entry's `data()` must be read to the end, or not at all,
// before asking for the next one.
export async function* tarEntries(src: AsyncIterable<Uint8Array>): AsyncGenerator<TarEntry> {
  const r = new Pull(src)
  let long: string | undefined
  let pax: Record<string, string> = {}
  for (;;) {
    const h = await r.exact(512)
    if (h.length < 512 || h.every((b) => b === 0)) return
    const flag = String.fromCharCode(h[156] || 48)
    let size = octal(h.subarray(124, 136))
    const pad = (n: number) => (512 - (n % 512)) % 512
    if (flag === "L" || flag === "x" || flag === "g" || flag === "K") {
      const body = await collect(r.take(size))
      await drain(r.take(pad(size)))
      if (flag === "L") long = cstr(body)
      if (flag === "x") {
        for (let i = 0; i < body.length; ) {
          const sp = body.indexOf(32, i)
          const len = Number(body.subarray(i, sp).toString())
          if (!len) break
          const rec = body.subarray(sp + 1, i + len - 1).toString("utf8")
          const eq = rec.indexOf("=")
          pax[rec.slice(0, eq)] = rec.slice(eq + 1)
          i += len
        }
      }
      continue
    }
    const prefix = cstr(h.subarray(345, 500))
    let name = pax.path ?? long ?? (prefix && h.subarray(257, 262).toString() === "ustar" ? `${prefix}/${cstr(h.subarray(0, 100))}` : cstr(h.subarray(0, 100)))
    if (pax.size) size = Number(pax.size)
    const type = flag === "5" || name.endsWith("/") ? "dir" : flag === "0" ? "file" : flag === "1" || flag === "2" ? "link" : "file"
    const mtime = Number(pax.mtime ?? octal(h.subarray(136, 148)))
    long = undefined
    pax = {}
    name = cleanName(name)
    let used = false
    yield {
      name,
      type,
      size: type === "file" ? size : 0,
      mtime,
      data: () => {
        used = true
        return r.take(type === "file" ? size : 0)
      },
    }
    if (!used) await drain(r.take(type === "file" ? size : 0))
    await drain(r.take(type === "file" ? pad(size) : 0))
  }
}
