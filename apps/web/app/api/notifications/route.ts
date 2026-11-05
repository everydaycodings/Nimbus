import { and, eq, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { notifications } from "@/lib/db/schema"
import { memberOrNull } from "@/lib/session"

// What the bell polls: unread notifications, and how many of them are new shares.
export async function GET() {
  const me = await memberOrNull()
  if (!me) return new Response("Sign in first", { status: 401 })
  const [row] = await db
    .select({
      unread: sql<number>`count(*)::int`,
      shared: sql<number>`(count(*) filter (where ${notifications.kind} = 'shared'))::int`,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt)))
  return Response.json(row, { headers: { "Cache-Control": "no-store" } })
}
