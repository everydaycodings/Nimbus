// A streaming zip reader for Takeout archives: they run to many gigabytes, so nothing is held whole. It reads the central
// directory from the end of the file, then each entry's bytes by range (S3 range reads), inflating on the way through.
// Handles zip64, stored and deflated entries. Plain code: rules.test.ts runs it on an in-memory zip.
import { Readable } from "node:stream"
import { createInflateRaw } from "node:zlib"

// range(start, end): the bytes from start up to (not including) end.
export type ZipSource = { size: number; range: (start: number, end: number) => Promise<AsyncIterable<Uint8Array>> }
export type ZipEntry = { name: string; size: number; csize: number; method: number; offset: number; dir: boolean; encrypted: boolean }

async function collect(parts: AsyncIterable<Uint8Array>) {
  const out: Buffer[] = []
  for await (const c of parts) out.push(Buffer.from(c))
  return Buffer.concat(out)
}

const u64 = (b: Buffer, at: number) => Number(b.readBigUInt64LE(at))

// Where the central directory is: from the end-of-central-directory record in the file's tail.
export function findDirectory(tail: Buffer, fileSize: number): { start: number; size: number; count: number } {
  let i = tail.length - 22
  for (; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) break
  if (i < 0) throw new Error("This isn't a zip file, or it is cut short.")
  let count = tail.readUInt16LE(i + 10)
  let size = tail.readUInt32LE(i + 12)
  let start = tail.readUInt32LE(i + 16)
  if (i >= 20 && tail.readUInt32LE(i - 20) === 0x07064b50) {
    // zip64: the real numbers sit in a record the locator points to (kept within the tail we read).
    const at = u64(tail, i - 20 + 8) - (fileSize - tail.length)
    if (at < 0 || at + 56 > tail.length || tail.readUInt32LE(at) !== 0x06064b50) throw new Error("This zip's directory is damaged.")
    count = u64(tail, at + 32)
    size = u64(tail, at + 40)
    start = u64(tail, at + 48)
  }
  return { start, size, count }
}

export function parseDirectory(buf: Buffer): ZipEntry[] {
  const out: ZipEntry[] = []
  let p = 0
  while (p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50) {
    const flags = buf.readUInt16LE(p + 8)
    let csize = buf.readUInt32LE(p + 20)
    let size = buf.readUInt32LE(p + 24)
    const n = buf.readUInt16LE(p + 28)
    const x = buf.readUInt16LE(p + 30)
    const c = buf.readUInt16LE(p + 32)
    let offset = buf.readUInt32LE(p + 42)
    const name = buf.toString("utf8", p + 46, p + 46 + n)
    // zip64 extra: only the fields that were 0xFFFFFFFF are there, in this order.
    for (let e = p + 46 + n, end = e + x; e + 4 <= end; ) {
      const id = buf.readUInt16LE(e)
      const len = buf.readUInt16LE(e + 2)
      if (id === 1) {
        let q = e + 4
        if (size === 0xffffffff) {
          size = u64(buf, q)
          q += 8
        }
        if (csize === 0xffffffff) {
          csize = u64(buf, q)
          q += 8
        }
        if (offset === 0xffffffff) offset = u64(buf, q)
      }
      e += 4 + len
    }
    out.push({ name, size, csize, method: buf.readUInt16LE(p + 10), offset, dir: name.endsWith("/"), encrypted: (flags & 1) === 1 })
    p += 46 + n + x + c
  }
  return out
}

export async function readEntries(src: ZipSource): Promise<ZipEntry[]> {
  const take = Math.min(src.size, 128 * 1024)
  const tail = await collect(await src.range(src.size - take, src.size))
  const dir = findDirectory(tail, src.size)
  const buf = await collect(await src.range(dir.start, dir.start + dir.size))
  return parseDirectory(buf)
}

// The entry's file bytes as a stream.
export async function openEntry(src: ZipSource, e: ZipEntry): Promise<Readable> {
  if (e.encrypted) throw new Error(`“${e.name}” is password protected.`)
  if (e.method !== 0 && e.method !== 8) throw new Error(`“${e.name}” uses a compression this reader doesn't know.`)
  if (e.csize === 0) return Readable.from([])
  const head = await collect(await src.range(e.offset, e.offset + 30))
  if (head.length < 30 || head.readUInt32LE(0) !== 0x04034b50) throw new Error(`“${e.name}” is damaged in the zip.`)
  const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
  const raw = Readable.from(await src.range(start, start + e.csize))
  if (e.method === 0) return raw
  const inflate = createInflateRaw()
  raw.on("error", (err) => inflate.destroy(err))
  return raw.pipe(inflate)
}
