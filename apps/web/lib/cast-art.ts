// The picture a TV shows while casting: an audio file's embedded cover (lib/cover-art.ts),
// else the file's thumbnail. Served by /api/v1/files/{id}/art under a signed token.
import "server-only"

import { and, eq, ne, isNotNull } from "drizzle-orm"

import { appUrl } from "@/lib/email"
import { db } from "@/lib/db"
import { fileVersions } from "@/lib/db/schema"
import { coverArt } from "@/lib/cover-art"
import { previewKind } from "@/lib/file-rules"
import { getRange, getStream, headSize, thumbKey } from "@/lib/s3"
import { signToken } from "@/lib/upload-rules"

const read = (key: string) => async (start: number, end: number) =>
  new Uint8Array(await new Response((await getRange(key, `bytes=${start}-${end - 1}`)).body).arrayBuffer())

export type Art = { body: BodyInit; type: string }

// The art for a file, or null when it has none.
export async function castArt(file: { key: string; name: string; mime: string | null }): Promise<Art | null> {
  if (previewKind(file.mime, file.name) === "audio") {
    const size = await headSize(file.key)
    const pic = size ? await coverArt(read(file.key), size).catch(() => null) : null
    if (pic) return { body: pic.data as BodyInit, type: pic.type }
  }
  const [t] = await db
    .select({ id: fileVersions.id })
    .from(fileVersions)
    .where(and(eq(fileVersions.s3Key, file.key), isNotNull(fileVersions.thumb), ne(fileVersions.thumb, "")))
    .limit(1)
  if (!t) return null
  return { body: await getStream(thumbKey(file.key)), type: "image/webp" }
}

// A signed URL a TV can fetch without signing in, for as long as the cast URL lives.
export const artUrl = (userId: string, id: string, seconds: number) =>
  `${appUrl()}/api/v1/files/${id}/art?t=${signToken("art", { u: userId, id }, seconds * 1000)}`
