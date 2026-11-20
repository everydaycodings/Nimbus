// Run: node --test lib/import/rules.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"
import { deflateRawSync } from "node:zlib"

import { etaOf, ini, iniFields, isSidecar, parseSidecar, parseTokenPaste, rcloneToken, sameFile, sameItem, sidecarCandidates, sidecarKey, takeoutDir } from "./rules.ts"
import { openEntry, readEntries, type ZipSource } from "./zip.ts"

const day = new Date("2024-05-01T10:00:00Z")
const remote = (o: object) => ({ Path: "a", Name: "a", Size: 5, ModTime: day.toISOString(), IsDir: false, ...o })

test("ini refuses line breaks and drops blanks", () => {
  assert.equal(ini("src", { type: "s3", region: "", endpoint: "http://x" }), "[src]\ntype = s3\nendpoint = http://x\n")
  assert.throws(() => ini("src", { key_pem: "a\nb" }))
  assert.deepEqual(iniFields("[src]\ntype = drive\ntoken = {\"a\":1}\n"), { type: "drive", token: '{"a":1}' })
})

test("token paste from rclone authorize", () => {
  const out = `Paste the following into your remote machine --->\n{"access_token":"ya29","token_type":"Bearer","refresh_token":"1//x","expiry":"2024-01-01T00:00:00Z"}\n<---End paste`
  assert.equal(parseTokenPaste(out)?.refresh_token, "1//x")
  assert.equal(parseTokenPaste("nothing here"), null)
  assert.equal(rcloneToken({ access_token: "a", expires_in: 60, token_type: "bearer" }, 0)?.expiry, "1970-01-01T00:01:00.000Z")
  assert.equal(rcloneToken({}), null)
})

test("same file: hash, then size and time", () => {
  const have = { size: 5, sha256: "AB", etag: null, mtime: day }
  assert.equal(sameFile(remote({ Hashes: { sha256: "ab" } }), have), true)
  assert.equal(sameFile(remote({ Hashes: { sha256: "cd" } }), have), false)
  assert.equal(sameFile(remote({ Hashes: { md5: "m" } }), { ...have, sha256: null, etag: "M" }), true)
  assert.equal(sameFile(remote({}), { ...have, sha256: null }), true)
  assert.equal(sameFile(remote({ Size: 6 }), { ...have, sha256: null }), false)
  assert.equal(sameFile(remote({ ModTime: "2024-05-01T10:00:09Z" }), { ...have, sha256: null }), false)
  assert.equal(sameItem(remote({ Size: -1 }), { size: 0, mtime: day }), true)
  assert.equal(sameItem(remote({}), { size: 4, mtime: day }), false)
})

test("eta waits for a few seconds of data", () => {
  assert.equal(etaOf(0, 100, 0, 10_000), null)
  assert.equal(etaOf(50, 100, 0, 10_000), 10)
  assert.equal(etaOf(50, 100, 0, 1000), null)
})

test("takeout sidecars", () => {
  assert.equal(sidecarKey("Trip/IMG_1.jpg.supplemental-metadata.json"), "trip/img_1.jpg")
  assert.equal(sidecarKey("Trip/IMG_1.jpg.supplemental-metad.json"), "trip/img_1.jpg")
  assert.equal(sidecarKey("Trip/IMG_1.jpg.json"), "trip/img_1.jpg")
  assert.equal(sidecarKey("Trip/IMG_1.jpg.supplemental-metadata(1).json"), "trip/img_1.jpg(1)")
  assert.deepEqual(sidecarCandidates("Trip/IMG_1(1).jpg"), ["trip/img_1(1).jpg", "trip/img_1.jpg(1)"])
  assert.deepEqual(sidecarCandidates("Trip/IMG_1-edited.jpg"), ["trip/img_1-edited.jpg", "trip/img_1.jpg"])
  const media = new Set(["a/p.jpg"])
  assert.equal(isSidecar("a/p.jpg.json", media), true)
  assert.equal(isSidecar("a/data.json", media), false)
  assert.equal(isSidecar("a/metadata.json", media), true)
  assert.equal(parseSidecar('{"photoTakenTime":{"timestamp":"1546300800"},"description":" hi ","favorited":true}')?.taken?.toISOString(), "2019-01-01T00:00:00.000Z")
  assert.equal(parseSidecar("nope"), null)
  assert.deepEqual(takeoutDir("Takeout/Google Photos/Trip/a.jpg"), ["Google Photos", "Trip"])
})

// A zip made by hand: one deflated file, one stored, a folder and a comment after the directory.
function makeZip(files: { name: string; data: Buffer; deflate: boolean }[]) {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let off = 0
  for (const f of files) {
    const body = f.deflate ? deflateRawSync(f.data) : f.data
    const name = Buffer.from(f.name)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(f.deflate ? 8 : 0, 8)
    lh.writeUInt32LE(body.length, 18)
    lh.writeUInt32LE(f.data.length, 22)
    lh.writeUInt16LE(name.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(f.deflate ? 8 : 0, 10)
    ch.writeUInt32LE(body.length, 20)
    ch.writeUInt32LE(f.data.length, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(off, 42)
    central.push(ch, name)
    parts.push(lh, name, body)
    off += 30 + name.length + body.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(off, 16)
  return Buffer.concat([...parts, dir, end])
}

test("zip reader: directory, stored and deflated entries", async () => {
  const big = Buffer.from("takeout ".repeat(5000))
  const zip = makeZip([
    { name: "Takeout/", data: Buffer.alloc(0), deflate: false },
    { name: "Takeout/a.txt", data: big, deflate: true },
    { name: "Takeout/b.json", data: Buffer.from('{"x":1}'), deflate: false },
  ])
  const src: ZipSource = {
    size: zip.length,
    range: async (a, b) =>
      (async function* () {
        yield zip.subarray(a, b)
      })(),
  }
  const entries = await readEntries(src)
  assert.deepEqual(entries.map((e) => [e.name, e.dir]), [["Takeout/", true], ["Takeout/a.txt", false], ["Takeout/b.json", false]])
  const read = async (n: string) => {
    const chunks: Buffer[] = []
    for await (const c of await openEntry(src, entries.find((e) => e.name === n)!)) chunks.push(c)
    return Buffer.concat(chunks)
  }
  assert.deepEqual(await read("Takeout/a.txt"), big)
  assert.equal((await read("Takeout/b.json")).toString(), '{"x":1}')
  await assert.rejects(readEntries({ size: 10, range: async () => (async function* () { yield Buffer.alloc(10) })() }), /zip/)
})
