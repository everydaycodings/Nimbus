// The ~1920 px JPEG Cast shows for a photo. Made on the first cast and kept in S3
// (previews/<key>.1920.jpg, cleaned up like thumbnails). HEIC goes through heic-decode and
// camera RAW through the JPEG every RAW file embeds, so both end up as plain JPEGs. No `@/` imports: the worker (scripts/ml.ts) reads these too.
import decode from "heic-decode"
import sharp from "sharp"

import { PREVIEW_PX, RAW_EXT, embeddedJpeg, previewKey } from "./playback-rules.ts"
import { getStream, headSize, presignGet, putObject } from "./s3.ts"

const MAX = 150 * 1024 ** 2

async function toJpeg(bytes: Uint8Array, name: string) {
  let input: ReturnType<typeof sharp>
  if (/\.hei[cf]$/i.test(name)) {
    const img = await decode({ buffer: bytes as unknown as ArrayBufferLike })
    input = sharp(Buffer.from(img.data.buffer), { raw: { width: img.width, height: img.height, channels: 4 } })
  } else if (RAW_EXT.test(name)) {
    const jpg = embeddedJpeg(bytes)
    if (!jpg) throw new Error("No preview inside that RAW file.")
    input = sharp(jpg).rotate()
  } else input = sharp(bytes, { limitInputPixels: 200_000_000 }).rotate()
  return input
    .resize(PREVIEW_PX, PREVIEW_PX, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#000" })
    .jpeg({ quality: 85 })
    .toBuffer()
}

// A presigned URL of the photo's preview, or null when it can't be decoded or is too big.
export async function previewImageUrl(
  file: { key: string; name: string },
  expiresIn: number
) {
  const key = previewKey(file.key)
  if ((await headSize(key)) === null) {
    const src = await headSize(file.key)
    if (src === null || src > MAX) return null
    const bytes = new Uint8Array(await new Response(await getStream(file.key)).arrayBuffer())
    try {
      await putObject(key, await toJpeg(bytes, file.name), "image/jpeg")
    } catch {
      return null
    }
  }
  return presignGet(key, file.name.replace(/\.[^.]+$/, "") + ".jpg", { inline: true, expiresIn, type: "image/jpeg" })
}
