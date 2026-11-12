import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { fail, json, query, withMember } from "@/lib/api"
import { db } from "@/lib/db"
import { signatures } from "@/lib/db/schema"

const kind = z.enum(["signature", "initials"])
const MAX = 300 * 1024
const PNG_HEAD = "89504e470d0a1a0a"

export const GET = () =>
  withMember(async (me) => {
    const rows = await db.select().from(signatures).where(eq(signatures.userId, me.id))
    const png = (k: string) => rows.find((r) => r.kind === k)?.png ?? null
    return Response.json({ signature: png("signature"), initials: png("initials") })
  })

export const PUT = (req: Request) =>
  withMember(async (me) => {
    // Base64 is a third bigger than the bytes it holds.
    const b = await json(req, z.object({ kind, png: z.string().max(Math.ceil((MAX * 4) / 3) + 4) }))
    if (b instanceof Response) return b
    const bytes = /^[A-Za-z0-9+/]+={0,2}$/.test(b.png) ? Buffer.from(b.png, "base64") : null
    if (!bytes || bytes.length > MAX || bytes.subarray(0, 8).toString("hex") !== PNG_HEAD)
      return fail(400, "bad-request", "Send a PNG of at most 300 KB.")
    await db
      .insert(signatures)
      .values({ userId: me.id, kind: b.kind, png: b.png })
      .onConflictDoUpdate({
        target: [signatures.userId, signatures.kind],
        set: { png: b.png, updatedAt: new Date() },
      })
    return Response.json({})
  })

export const DELETE = (req: Request) =>
  withMember(async (me) => {
    const q = query(req, z.object({ kind }))
    if (q instanceof Response) return q
    await db.delete(signatures).where(and(eq(signatures.userId, me.id), eq(signatures.kind, q.kind)))
    return Response.json({})
  })
