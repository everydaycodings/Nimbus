// When a photo was taken, from the raw EXIF block sharp's metadata() returns
// (TIFF structure, with or without the leading "Exif\0\0"). Reads
// DateTimeOriginal, then DateTimeDigitized, then DateTime.
// ponytail: EXIF times have no zone, so they're read as UTC; use OffsetTimeOriginal if that ever shows a day wrong.

const EXIF_IFD = 0x8769
const WANTED = [0x9003, 0x9004, 0x0132]

// "2024:05:17 14:03:09" -> Date, null for blanks like "0000:00:00 00:00:00".
export function parseExifDate(s: string): Date | null {
  const m = /^(\d{4}):(\d\d):(\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(s)
  if (!m) return null
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number)
  const t = Date.UTC(y, mo - 1, d, h, mi, se)
  const date = new Date(t)
  return y >= 1970 && mo >= 1 && mo <= 12 && d >= 1 && date.getUTCDate() === d
    ? date
    : null
}

export function exifTakenAt(exif: Uint8Array): Date | null {
  const v = new DataView(exif.buffer, exif.byteOffset, exif.byteLength)
  let base = 0
  if (exif.length > 6 && exif[0] === 0x45 && exif[1] === 0x78) base = 6
  if (exif.length < base + 8) return null
  const le = exif[base] === 0x49
  if (!le && exif[base] !== 0x4d) return null
  const u16 = (o: number) => v.getUint16(base + o, le)
  const u32 = (o: number) => v.getUint32(base + o, le)
  const inside = (o: number, n: number) => o >= 0 && base + o + n <= exif.length

  // tag -> value offset (of the ASCII text, or of the sub-IFD pointer value)
  const entries = (ifd: number) => {
    const found = new Map<number, number>()
    if (!inside(ifd, 2)) return found
    const n = u16(ifd)
    for (let i = 0; i < n && inside(ifd + 2 + i * 12, 12); i++) {
      const at = ifd + 2 + i * 12
      const tag = u16(at)
      const count = u32(at + 4)
      // ASCII longer than 4 bytes lives at an offset; the pointer tag's value is the offset.
      found.set(tag, tag === EXIF_IFD || count <= 4 ? at + 8 : u32(at + 8))
      found.set(-tag, count)
    }
    return found
  }
  const text = (e: Map<number, number>, tag: number) => {
    const at = e.get(tag)
    const n = e.get(-tag)
    if (at === undefined || !n || !inside(at, n)) return null
    return new TextDecoder().decode(exif.subarray(base + at, base + at + n))
  }

  const ifd0 = entries(u32(4))
  const sub = ifd0.has(EXIF_IFD) ? entries(u32(ifd0.get(EXIF_IFD)!)) : new Map()
  for (const tag of WANTED) {
    const s = text(tag === 0x0132 ? ifd0 : sub, tag)
    const d = s && parseExifDate(s)
    if (d) return d
  }
  return null
}
