// Embedded cover art: ID3v2.3/2.4 APIC frames (MP3) and the covr atom
// (MP4/M4A). Reads only the tag, through `read`, so it works on a local File
// or a ranged fetch alike.
export type Read = (start: number, end: number) => Promise<Uint8Array>
export type Picture = { data: Uint8Array; type: string }

// Tags with embedded art are rarely bigger than this.
const MAX = 8 * 1024 * 1024

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to))
const u32 = (b: Uint8Array, i: number) =>
  ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const syncsafe = (b: Uint8Array, i: number) =>
  (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3]

export async function coverArt(
  read: Read,
  size: number
): Promise<Picture | null> {
  if (size < 12) return null
  const head = await read(0, 12)
  if (ascii(head, 0, 3) === "ID3") return id3(read, head, size)
  if (ascii(head, 4, 8) === "ftyp") return mp4(read, size)
  return null
}

async function id3(read: Read, head: Uint8Array, size: number) {
  const v = head[3]
  const flags = head[5]
  // v2.2 frames and unsynchronised tags are rare enough to skip.
  if ((v !== 3 && v !== 4) || flags & 0x80) return null
  const tag = await read(0, Math.min(10 + syncsafe(head, 6), size, MAX))
  let pos = 10
  if (flags & 0x40) pos += v === 4 ? syncsafe(tag, 10) : 4 + u32(tag, 10)
  let found: Picture | null = null
  while (pos + 10 <= tag.length && tag[pos] !== 0) {
    const len = v === 4 ? syncsafe(tag, pos + 4) : u32(tag, pos + 4)
    const end = pos + 10 + len
    if (end > tag.length) break
    if (ascii(tag, pos, pos + 4) === "APIC") {
      const pic = apic(tag.subarray(pos + 10, end))
      // Picture type 3 is the front cover; otherwise take the first.
      if (pic && (pic.front || !found)) found = pic
      if (pic?.front) break
    }
    pos = end
  }
  return found && { data: found.data, type: found.type }
}

function apic(b: Uint8Array) {
  const wide = b[0] === 1 || b[0] === 2
  const mimeEnd = b.indexOf(0, 1)
  if (mimeEnd < 0) return null
  let type = ascii(b, 1, mimeEnd).toLowerCase()
  if (!type.includes("/")) type = `image/${type === "jpg" ? "jpeg" : type}`
  const front = b[mimeEnd + 1] === 3
  // The description ends at a null, two bytes wide (and aligned) in UTF-16.
  const start = mimeEnd + 2
  let i = start
  if (wide) {
    while (i + 1 < b.length && (b[i] || b[i + 1])) i += 2
    i += 2
  } else {
    while (i < b.length && b[i]) i++
    i += 1
  }
  if (i >= b.length) return null
  return { data: b.slice(i), type, front }
}

// moov > udta > meta > ilst > covr > data
async function mp4(read: Read, size: number) {
  let pos = 0
  while (pos + 8 <= size) {
    const h = await read(pos, Math.min(pos + 16, size))
    let len = u32(h, 0)
    if (len === 1) len = u32(h, 8) * 2 ** 32 + u32(h, 12)
    else if (len === 0) len = size - pos
    if (len < 8) return null
    if (ascii(h, 4, 8) === "moov") {
      const moov = await read(pos, Math.min(pos + len, size, pos + MAX))
      return covr(moov)
    }
    pos += len
  }
  return null
}

function covr(moov: Uint8Array): Picture | null {
  let from = 8
  let to = moov.length
  for (const name of ["udta", "meta", "ilst", "covr", "data"]) {
    const box = child(moov, from, to, name)
    if (!box) return null
    // meta is a "full box": 4 bytes of version and flags before its children.
    from = box.start + (name === "meta" ? 12 : 8)
    to = box.end
    if (name === "data") {
      // 4 bytes of type (13 JPEG, 14 PNG), 4 of locale, then the image.
      const kind = u32(moov, from) & 0xffffff
      return {
        data: moov.slice(from + 8, to),
        type: kind === 14 ? "image/png" : "image/jpeg",
      }
    }
  }
  return null
}

function child(b: Uint8Array, from: number, to: number, name: string) {
  let pos = from
  while (pos + 8 <= to) {
    const len = u32(b, pos)
    if (len < 8 || pos + len > to) return null
    if (ascii(b, pos + 4, pos + 8) === name)
      return { start: pos, end: pos + len }
    pos += len
  }
  return null
}
