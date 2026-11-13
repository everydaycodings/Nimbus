// Partner sharing: one member shares their photos and videos (all, or from a date) with another,
// who sees them merged into their timeline (lib/access gives the view; lib/files merges them)
// and can save copies into their own files.
import "server-only"

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import type {
  PartnerInvite,
  PartnerPatch,
  PartnerPerson,
  PartnerResponse,
  PartnerShare,
} from "@nimbus/shared/api"

import { accessTo } from "@/lib/access"
import { db } from "@/lib/db"
import { fileVersions, nodes, partners, user } from "@/lib/db/schema"
import { formatBytes } from "@/lib/file-rules"
import { notify } from "@/lib/notify"
import { spaceLeft, checkStorage } from "@/lib/quota"
import { enqueueDerive } from "@/lib/redis"
import { copyObject, deleteKeys, thumbKey } from "@/lib/s3"
import { newKey } from "@/lib/services/transfers"
import type { Me } from "@/lib/session"
import { mkdirp, saveUploaded } from "@/lib/uploads"

type Result = { error?: string }
const GONE = "That person isn't available anymore."

const person = (u: { id: string; name: string; email: string; image: string | null }): PartnerPerson => ({
  id: u.id,
  name: u.name || u.email,
  email: u.email,
  image: u.image,
})

// "2024-05-01" or a full ISO time, or null for all photos.
function sinceOf(raw: string | null | undefined) {
  if (raw === undefined) return { value: undefined }
  if (raw === null || raw === "") return { value: null }
  const at = new Date(raw)
  return Number.isNaN(at.getTime()) ? { error: "Pick a valid date." } : { value: at }
}

export async function getPartners(me: Me): Promise<PartnerResponse> {
  const cols = {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    status: partners.status,
    since: partners.since,
    hidden: partners.hidden,
  }
  const share = (r: Awaited<ReturnType<typeof out>>[number]): PartnerShare => ({
    person: person(r),
    status: r.status,
    since: r.since?.toISOString() ?? null,
    hidden: r.hidden,
  })
  const out = () =>
    db
      .select(cols)
      .from(partners)
      .innerJoin(user, eq(user.id, partners.partnerId))
      .where(eq(partners.ownerId, me.id))
  const [o] = await out()
  const incoming = await db
    .select(cols)
    .from(partners)
    .innerJoin(user, eq(user.id, partners.ownerId))
    .where(eq(partners.partnerId, me.id))
  return { outgoing: o ? share(o) : null, incoming: incoming.map(share) }
}

export async function invite(me: Me, input: PartnerInvite): Promise<Result> {
  const id = String(input.userId)
  if (id === me.id) return { error: "Pick someone else." }
  const since = sinceOf(input.since)
  if (since.error) return { error: since.error }
  const [target] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(and(eq(user.id, id), eq(user.status, "active")))
  if (!target) return { error: GONE }
  const [mine] = await db.select().from(partners).where(eq(partners.ownerId, me.id))
  if (mine)
    return { error: "You already share your photos with someone. Stop that first." }
  await db
    .insert(partners)
    .values({ ownerId: me.id, partnerId: id, since: since.value ?? null })
  await notify(id, "partner", { actorId: me.id, data: { what: "invite" } })
  return {}
}

export async function updatePartner(me: Me, p: PartnerPatch): Promise<Result> {
  const other = String(p.userId)
  const mine = and(eq(partners.ownerId, me.id), eq(partners.partnerId, other))
  const theirs = and(eq(partners.ownerId, other), eq(partners.partnerId, me.id))
  if (p.stop) {
    await db.delete(partners).where(mine)
    return {}
  }
  if (p.decline) {
    await db.delete(partners).where(theirs)
    return {}
  }
  if (p.since !== undefined) {
    const since = sinceOf(p.since)
    if (since.error) return { error: since.error }
    const r = await db.update(partners).set({ since: since.value }).where(mine).returning()
    if (!r.length) return { error: GONE }
  }
  if (p.hidden !== undefined) {
    const r = await db
      .update(partners)
      .set({ hidden: Boolean(p.hidden) })
      .where(theirs)
      .returning()
    if (!r.length) return { error: GONE }
  }
  if (p.accept) {
    const r = await db
      .update(partners)
      .set({ status: "active" })
      .where(theirs)
      .returning()
    if (!r.length) return { error: GONE }
    const back = Boolean(p.shareBack)
    // One person at a time: sharing back only when I'm not already sharing with someone else.
    const [already] = await db.select().from(partners).where(eq(partners.ownerId, me.id))
    const shared = back && !already
    if (shared)
      await db
        .insert(partners)
        .values({ ownerId: me.id, partnerId: other, status: "active" })
    await notify(other, "partner", {
      actorId: me.id,
      data: { what: "accepted", back: shared ? "1" : "" },
    })
  }
  return {}
}

// Copies of a partner's (or album's) photos in my own files, under "Photos/From <name>", with
// the same quota check as an upload. Like saving a transfer: the bytes are copied, so they're mine.
export async function saveCopy(
  me: Me,
  nodeIds: string[]
): Promise<Result & { saved?: number; folderId?: string }> {
  const ids = Array.isArray(nodeIds) ? nodeIds.slice(0, 200) : []
  const access = await accessTo(me.id, ids)
  const ok = ids.filter((id) => {
    const a = access.get(id)
    return a && a.kind === "file" && !a.trashed && a.ownerId !== me.id
  })
  const files = (
    ok.length
      ? await db
          .select({
            id: nodes.id,
            name: nodes.name,
            mime: nodes.mime,
            size: nodes.size,
            key: nodes.s3Key,
            thumb: fileVersions.thumb,
            owner: sql<string>`coalesce(nullif(${user.name}, ''), ${user.email})`,
          })
          .from(nodes)
          .innerJoin(fileVersions, eq(fileVersions.id, nodes.currentVersionId))
          .innerJoin(user, eq(user.id, nodes.ownerId))
          .where(and(inArray(nodes.id, ok), isNotNull(nodes.s3Key)))
      : []
  ).map((f) => ({ ...f, key: f.key! }))
  if (!files.length) return { error: "Those photos aren't available anymore." }
  const need = files.reduce((n, f) => n + f.size, 0)
  const left = await spaceLeft(me.id)
  if (left !== null && need > left)
    return {
      error: `This needs ${formatBytes(need)}, but only ${formatBytes(left)} is left in your storage.`,
    }
  const copies: { key: string; f: (typeof files)[number] }[] = []
  try {
    for (const f of files) {
      const key = newKey()
      await copyObject(f.key, key)
      copies.push({ key, f })
      if (f.thumb) await copyObject(thumbKey(f.key), thumbKey(key)).catch(() => {})
    }
    let folderId = ""
    const versions = await db.transaction(async (tx) => {
      const cache = new Map<string, string>()
      const out: string[] = []
      for (const { key, f } of copies) {
        const from = `From ${f.owner.replace(/[\\/]/g, " ").trim() || "partner"}`
        const dir = await mkdirp(tx, me.id, null, ["Photos", from], cache)
        if ("error" in dir) throw new Error(dir.error)
        folderId = dir.id!
        await tx.update(nodes).set({ systemKind: "partner" }).where(and(eq(nodes.id, folderId), isNull(nodes.systemKind)))
        const r = await saveUploaded(tx, {
          ownerId: me.id,
          parentId: dir.id,
          name: f.name,
          version: { s3Key: key, size: f.size, mime: f.mime, uploadedBy: me.id },
          onConflict: "keep",
        })
        if (r.error) throw new Error(r.error)
        if (r.versionId) out.push(r.versionId)
      }
      return out
    })
    await checkStorage(me.id)
    for (const v of versions) await enqueueDerive(v).catch(() => {})
    return { saved: copies.length, folderId }
  } catch (e) {
    console.error("[partner] save failed", e)
    await deleteKeys(copies.map((c) => c.key))
    return { error: "Couldn't save the photos. Try again." }
  }
}
