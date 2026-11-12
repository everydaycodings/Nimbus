// Public album links (/a/<token>): lookup, password and unlock cookie, and the photos a link
// shows. Modelled on lib/links.ts. A link never shows GPS or anything about who else has the album.
import "server-only"

import { and, eq, gt, isNull, or, sql } from "drizzle-orm"
import { cookies } from "next/headers"

import { overLimit } from "@/lib/cache"
import { db } from "@/lib/db"
import {
  albumItems,
  albumShares,
  albums,
  nodes,
  settings,
  user,
} from "@/lib/db/schema"
import { UUID } from "@/lib/file-rules"
import { photoItems } from "@/lib/files"
import { checkPassword, clientIp } from "@/lib/links"
import { readToken, signToken } from "@/lib/upload-rules"

export type AlbumLink = NonNullable<Awaited<ReturnType<typeof findAlbumLink>>>

// A link that works right now: public links on, not expired, owner still active.
export async function findAlbumLink(token: string) {
  if (!/^[\w-]{10,64}$/.test(token)) return null
  const [row] = await db
    .select({
      id: albumShares.id,
      albumId: albums.id,
      name: albums.name,
      passwordHash: albumShares.passwordHash,
      pwRev: albumShares.pwRev,
      allowDownload: albumShares.allowDownload,
      expiresAt: albumShares.expiresAt,
      ownerId: albums.ownerId,
      ownerName: user.name,
    })
    .from(albumShares)
    .innerJoin(albums, eq(albums.id, albumShares.albumId))
    .innerJoin(user, eq(user.id, albums.ownerId))
    .innerJoin(settings, sql`true`)
    .where(
      and(
        eq(albumShares.token, token),
        eq(settings.publicLinksEnabled, true),
        eq(user.status, "active"),
        or(isNull(albumShares.expiresAt), gt(albumShares.expiresAt, sql`now()`))
      )
    )
  return row ?? null
}

const cookieName = (id: string) => `nimbus_album_${id}`
const DAY = 24 * 60 * 60 * 1000

export async function albumUnlocked(link: AlbumLink) {
  if (!link.passwordHash) return true
  const t = readToken<{ s: string; r: number; exp: number }>(
    "link-unlock",
    (await cookies()).get(cookieName(link.id))?.value
  )
  return Boolean(t && t.s === link.id && t.r === link.pwRev && t.exp > Date.now())
}

// ponytail: 10 tries per IP per link per 15 minutes in Redis (right ones count too); no Redis, no limit.
export async function unlockAlbum(link: AlbumLink, pw: string) {
  const ip = (await clientIp()) ?? "?"
  if (await overLimit(`rl:album-unlock:${link.id}:${ip}`, 10, 15 * 60))
    return { error: "Too many wrong tries. Wait 15 minutes and try again." }
  if (!link.passwordHash || !(await checkPassword(pw, link.passwordHash)))
    return { error: "That password isn't right." }
  ;(await cookies()).set(
    cookieName(link.id),
    signToken("link-unlock", { s: link.id, r: link.pwRev }, DAY),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: DAY / 1000,
      path: "/",
    }
  )
  return {}
}

export async function openAlbumLink(token: string) {
  const link = await findAlbumLink(token)
  return link && (await albumUnlocked(link)) ? link : null
}

// A visitor's page loads per IP per minute.
export async function albumPageLimited() {
  return overLimit(`rl:album-page:${(await clientIp()) ?? "?"}`, 120, 60)
}

export async function countAlbumView(id: string) {
  await db
    .update(albumShares)
    .set({ viewCount: sql`${albumShares.viewCount} + 1` })
    .where(eq(albumShares.id, id))
}

// `id` if it's in the album and untrashed.
export async function albumNode(link: AlbumLink, id: string) {
  if (!UUID.test(id)) return null
  const [row] = await db
    .select({ id: nodes.id, name: nodes.name, key: nodes.s3Key, mime: nodes.mime })
    .from(albumItems)
    .innerJoin(nodes, eq(nodes.id, albumItems.nodeId))
    .where(
      and(
        eq(albumItems.albumId, link.albumId),
        eq(nodes.id, id),
        eq(nodes.kind, "file"),
        isNull(nodes.trashedAt),
        isNull(nodes.vaultId)
      )
    )
  return row ?? null
}

// The album's photos as a visitor sees them: no tags, stars, owners, sharing facts or comments.
export async function albumPhotos(link: AlbumLink) {
  const { items } = await photoItems(
    link.ownerId,
    and(
      eq(nodes.kind, "file"),
      isNull(nodes.trashedAt),
      isNull(nodes.vaultId),
      sql`"nodes".id in (select node_id from album_items where album_id = ${link.albumId})`
    ),
    2000
  )
  return items.map((i) => ({
    ...i,
    owner: undefined,
    ownerImage: undefined,
    role: undefined,
    fromPartner: undefined,
    tags: [],
    starred: false,
    comments: undefined,
    sharedWithPeople: false,
    hasLink: false,
  }))
}
