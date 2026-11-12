// Carries a photo's EXIF date and GPS into an edited JPEG. Editors re-encode the pixels, which drops EXIF,
// so the app reads the original's date and position (readExif) and writes a small APP1 block back (withExif).
// The block holds Orientation=1 (the pixels are already upright), DateTimeOriginal and the GPS IFD, nothing else.
// ponytail: a fresh minimal block, not a copy of the original's, so camera make/model, lens and exposure are not kept.

export type ExifMeta = { takenAt?: Date | null; gps?: { lat: number; lng: number } | null }

const pad = (n: number, w = 2) => String(n).padStart(w, "0")
const stamp = (d: Date) =>
  `${pad(d.getUTCFullYear(), 4)}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`

// The EXIF APP1 payload of a JPEG ("Exif\0\0" + TIFF), or null.
export function exifOf(jpeg: Uint8Array): Uint8Array | null {
  for (const s of segments(jpeg)) if (isExif(jpeg, s)) return jpeg.subarray(s.start + 4, s.end)
  return null
}

type Seg = { start: number; end: number; marker: number }
// The marker segments before the image data: [start of FF xx, end of the segment).
function segments(b: Uint8Array): Seg[] {
  const out: Seg[] = []
  if (b[0] !== 0xff || b[1] !== 0xd8) return out
  let i = 2
  while (i + 4 <= b.length && b[i] === 0xff && b[i + 1] >= 0xe0 && b[i + 1] <= 0xef) {
    const end = i + 2 + ((b[i + 2] << 8) | b[i + 3])
    if (end > b.length) break
    out.push({ start: i, end, marker: b[i + 1] })
    i = end
  }
  return out
}
const isExif = (b: Uint8Array, s: Seg) => s.marker === 0xe1 && b[s.start + 4] === 0x45 && b[s.start + 5] === 0x78 && b[s.start + 6] === 0x69 && b[s.start + 7] === 0x66

// ---- Writing ----

const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 } as const

function tiff(meta: ExifMeta) {
  const date = meta.takenAt && !Number.isNaN(meta.takenAt.getTime()) ? meta.takenAt : null
  const gps = meta.gps && Math.abs(meta.gps.lat) <= 90 && Math.abs(meta.gps.lng) <= 180 ? meta.gps : null
  const n0 = 1 + (date ? 1 : 0) + (gps ? 1 : 0)
  const exifAt = 8 + 2 + n0 * 12 + 4
  const gpsAt = exifAt + (date ? 18 : 0)
  const dataAt = gpsAt + (gps ? 54 : 0)
  const buf = new Uint8Array(dataAt + 20 + 48)
  const v = new DataView(buf.buffer)
  let data = dataAt

  const entry = (at: number, tag: number, type: keyof typeof SIZE, count: number, value: number | "data") => {
    v.setUint16(at, tag)
    v.setUint16(at + 2, type)
    v.setUint32(at + 4, count)
    if (value === "data") v.setUint32(at + 8, data)
    else if (type === 3) v.setUint16(at + 8, value)
    else v.setUint32(at + 8, value)
  }
  const ascii = (s: string) => {
    for (let i = 0; i < s.length; i++) buf[data + i] = s.charCodeAt(i)
    data += s.length + 1
  }
  const dms = (deg: number) => {
    const a = Math.abs(deg)
    const d = Math.floor(a)
    const m = Math.floor((a - d) * 60)
    const s = Math.round(((a - d) * 60 - m) * 60 * 10000)
    for (const [i, [num, den]] of [[d, 1], [m, 1], [s, 10000]].entries()) {
      v.setUint32(data + i * 8, num)
      v.setUint32(data + i * 8 + 4, den)
    }
    data += 24
  }

  buf.set([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8])
  v.setUint16(8, n0)
  let at = 10
  entry(at, 0x0112, 3, 1, 1)
  at += 12
  if (date) {
    entry(at, 0x8769, 4, 1, exifAt)
    at += 12
  }
  if (gps) entry(at, 0x8825, 4, 1, gpsAt)
  if (date) {
    v.setUint16(exifAt, 1)
    entry(exifAt + 2, 0x9003, 2, 20, "data")
    ascii(stamp(date))
  }
  if (gps) {
    v.setUint16(gpsAt, 4)
    entry(gpsAt + 2, 0x0001, 2, 2, 0)
    buf[gpsAt + 10] = gps.lat < 0 ? 0x53 : 0x4e
    entry(gpsAt + 14, 0x0002, 5, 3, "data")
    dms(gps.lat)
    entry(gpsAt + 26, 0x0003, 2, 2, 0)
    buf[gpsAt + 34] = gps.lng < 0 ? 0x57 : 0x45
    entry(gpsAt + 38, 0x0004, 5, 3, "data")
    dms(gps.lng)
  }
  return buf.subarray(0, data)
}

// The JPEG with its EXIF replaced by one holding Orientation=1 and `meta`. Not a JPEG: returned as given.
export function withExif(jpeg: Uint8Array, meta: ExifMeta): Uint8Array {
  const segs = segments(jpeg)
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg
  const body = tiff(meta)
  const app1 = new Uint8Array(10 + body.length)
  app1.set([0xff, 0xe1, ((body.length + 8) >> 8) & 0xff, (body.length + 8) & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0], 0)
  app1.set(body, 10)
  // After JFIF (APP0) when there is one, and without any EXIF the encoder already wrote.
  const keep = segs.filter((s) => !isExif(jpeg, s))
  const head = keep.length && keep[0].marker === 0xe0 ? keep.shift()! : null
  const after = segs.length ? segs[segs.length - 1].end : 2
  const parts = [jpeg.subarray(0, 2), ...(head ? [jpeg.subarray(head.start, head.end)] : []), app1, ...keep.map((s) => jpeg.subarray(s.start, s.end)), jpeg.subarray(after)]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

// ---- Reading ----

// DateTimeOriginal and the GPS position of a JPEG, or empty. Reads our own block and a camera's.
export function readExif(jpeg: Uint8Array): ExifMeta {
  const x = exifOf(jpeg)
  if (!x || x.length < 14) return {}
  const base = 6
  const v = new DataView(x.buffer, x.byteOffset, x.byteLength)
  const le = x[base] === 0x49
  if (!le && x[base] !== 0x4d) return {}
  const u16 = (o: number) => v.getUint16(base + o, le)
  const u32 = (o: number) => v.getUint32(base + o, le)
  const inside = (o: number, n: number) => o >= 0 && base + o + n <= x.length
  const ifd = (o: number) => {
    const m = new Map<number, { type: number; count: number; at: number }>()
    if (!inside(o, 2)) return m
    for (let i = 0, n = u16(o); i < n && inside(o + 2 + i * 12, 12); i++) {
      const e = o + 2 + i * 12
      const type = u16(e + 2)
      const count = u32(e + 4)
      const size = (SIZE[type as keyof typeof SIZE] ?? 1) * count
      m.set(u16(e), { type, count, at: size <= 4 ? e + 8 : u32(e + 8) })
    }
    return m
  }
  const out: ExifMeta = {}
  const ifd0 = ifd(u32(4))
  const sub = ifd0.get(0x8769) && ifd(u32(ifd0.get(0x8769)!.at))
  const dt = sub?.get(0x9003)
  if (dt && inside(dt.at, dt.count)) {
    const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(new TextDecoder().decode(x.subarray(base + dt.at, base + dt.at + dt.count)))
    const [y, mo, d, h, mi, s] = (m ?? []).slice(1).map(Number)
    if (m && y >= 1970 && mo >= 1 && mo <= 12 && d >= 1) out.takenAt = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  }
  const g = ifd0.get(0x8825) && ifd(u32(ifd0.get(0x8825)!.at))
  const deg = (tag: number, ref: number) => {
    const e = g?.get(tag)
    const r = g?.get(ref)
    if (!e || e.type !== 5 || e.count < 3 || !inside(e.at, 24) || !r || !inside(r.at, 1)) return null
    const part = (i: number) => u32(e.at + i * 8) / (u32(e.at + i * 8 + 4) || 1)
    const sign = (x[base + r.at] === 0x53 || x[base + r.at] === 0x57) ? -1 : 1
    return sign * (part(0) + part(1) / 60 + part(2) / 3600)
  }
  const lat = deg(0x0002, 0x0001)
  const lng = deg(0x0004, 0x0003)
  if (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)) out.gps = { lat, lng }
  return out
}
